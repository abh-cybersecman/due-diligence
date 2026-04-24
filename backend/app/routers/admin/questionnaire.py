"""Admin questionnaire endpoints.

Phase Q2 added read-only listing of versions, sections, questions, and options.
Phase Q3 originally exposed a set of per-mutation endpoints; the editor has
since moved to a single batched save where the full draft state is posted and
the backend reconciles it against the current DB. The per-mutation endpoints
were removed so the two code paths cannot drift.
"""
from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.audit_log import ActorType
from app.models.question import Question, ResponseType
from app.models.question_option import QuestionOption
from app.models.questionnaire_section import QuestionnaireSection
from app.models.questionnaire_version import QuestionnaireVersion
from app.schemas.questionnaire import (
    QuestionnaireVersionDetail,
    QuestionnaireVersionSummary,
    SaveDraftBody,
    SaveDraftResponse,
    SaveDraftSummary,
)
from app.services.audit import log_action
from app.services.auth import get_admin_user
from app.services.questionnaire import renumber_version
from app.utils.sanitize import sanitize_text

router = APIRouter(prefix="/questionnaire", tags=["admin-questionnaire"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_version_detail(
    db: AsyncSession, version_id: uuid.UUID
) -> QuestionnaireVersion | None:
    result = await db.execute(
        select(QuestionnaireVersion)
        .where(QuestionnaireVersion.id == version_id)
        .options(
            selectinload(QuestionnaireVersion.sections)
            .selectinload(QuestionnaireSection.questions)
            .selectinload(Question.options)
        )
    )
    return result.scalar_one_or_none()


async def _get_draft_id(db: AsyncSession) -> uuid.UUID:
    row = await db.execute(
        select(QuestionnaireVersion.id).where(QuestionnaireVersion.is_draft.is_(True))
    )
    draft_id = row.scalar_one_or_none()
    if draft_id is None:
        raise HTTPException(status_code=404, detail="No draft questionnaire version exists")
    return draft_id


def _mint_question_key() -> str:
    # token_urlsafe(6) yields 8 URL-safe characters.
    return f"q_{secrets.token_urlsafe(6)[:8]}"


def _serialize_question(q: Question) -> dict:
    return {
        "id": q.id,
        "version_id": q.version_id,
        "section_id": q.section_id,
        "question_number": q.question_number,
        "question_key": q.question_key,
        "question_text": q.question_text,
        "response_type": q.response_type,
        "allows_other": q.allows_other,
        "hint_text": q.hint_text,
        "is_required": q.is_required,
        "order": q.order,
        "options": [
            {"id": o.id, "label": o.label, "order": o.order}
            for o in sorted(q.options, key=lambda o: o.order)
        ],
    }


def _serialize_version(version: QuestionnaireVersion) -> dict:
    return {
        "id": version.id,
        "version_label": version.version_label,
        "is_current": version.is_current,
        "is_draft": version.is_draft,
        "published_at": version.published_at,
        "changelog": version.changelog,
        "created_at": version.created_at,
        "updated_at": version.updated_at,
        "sections": [
            {
                "id": section.id,
                "version_id": section.version_id,
                "title": section.title,
                "order": section.order,
                "is_ai_addendum": section.is_ai_addendum,
                "questions": [
                    _serialize_question(q)
                    for q in sorted(section.questions, key=lambda q: q.order)
                ],
            }
            for section in sorted(version.sections, key=lambda s: s.order)
        ],
    }


def _is_choice_type(rt: ResponseType) -> bool:
    return rt in (ResponseType.SINGLE_CHOICE, ResponseType.MULTI_CHOICE)


# ---------------------------------------------------------------------------
# Read endpoints (Phase Q2)
# ---------------------------------------------------------------------------


@router.get("/versions", response_model=list[QuestionnaireVersionSummary])
async def list_versions(
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[QuestionnaireVersionSummary]:
    result = await db.execute(
        select(QuestionnaireVersion).order_by(
            QuestionnaireVersion.is_draft.desc(),
            QuestionnaireVersion.is_current.desc(),
            QuestionnaireVersion.created_at.desc(),
        )
    )
    return [QuestionnaireVersionSummary.model_validate(v) for v in result.scalars().all()]


@router.get("/draft", response_model=QuestionnaireVersionDetail)
async def get_draft(
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> QuestionnaireVersionDetail:
    draft_id = await _get_draft_id(db)
    version = await _load_version_detail(db, draft_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Draft questionnaire version not found")

    return QuestionnaireVersionDetail.model_validate(_serialize_version(version))


@router.get("/versions/{version_id}", response_model=QuestionnaireVersionDetail)
async def get_version(
    version_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> QuestionnaireVersionDetail:
    version = await _load_version_detail(db, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Questionnaire version not found")

    return QuestionnaireVersionDetail.model_validate(_serialize_version(version))


# ---------------------------------------------------------------------------
# Batched save
# ---------------------------------------------------------------------------


@router.post("/draft/save", response_model=SaveDraftResponse)
async def save_draft(
    body: SaveDraftBody,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> SaveDraftResponse:
    """Reconcile the posted draft state against the DB.

    Create, update, delete sections / questions / options to match the payload
    exactly. Atomic — the whole thing runs inside the request's transaction.
    """
    draft_id = await _get_draft_id(db)

    version = await _load_version_detail(db, draft_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Draft questionnaire version not found")

    # Index the existing draft for fast lookup and ownership checks.
    existing_sections: dict[uuid.UUID, QuestionnaireSection] = {
        s.id: s for s in version.sections
    }
    existing_questions: dict[uuid.UUID, Question] = {
        q.id: q for s in version.sections for q in s.questions
    }
    # Snapshot the options per question into a plain dict *now*, while the
    # selectinload'd relationships are still loaded. Subsequent flushes /
    # cascade deletes can invalidate ORM collection state and accessing
    # `.options` later triggers an async lazy-load that breaks under the
    # request's greenlet.
    options_by_question: dict[uuid.UUID, list[QuestionOption]] = {
        q.id: list(q.options) for q in existing_questions.values()
    }
    existing_options: dict[uuid.UUID, QuestionOption] = {
        o.id: o
        for opts in options_by_question.values()
        for o in opts
    }

    # Validate ownership: every id referenced in the payload must already
    # belong to this draft. Foreign ids would otherwise be silently swallowed
    # by the "else: create new" branches.
    payload_section_ids = {s.id for s in body.sections if s.id is not None}
    for sid in payload_section_ids:
        if sid not in existing_sections:
            raise HTTPException(
                status_code=400,
                detail=f"Section {sid} does not belong to the current draft",
            )

    payload_question_ids: set[uuid.UUID] = set()
    for s in body.sections:
        for q in s.questions:
            if q.id is not None:
                if q.id not in existing_questions:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Question {q.id} does not belong to the current draft",
                    )
                payload_question_ids.add(q.id)

    summary = SaveDraftSummary()
    warnings: list[str] = []

    # ---- Deletes first so MAX(question_number) is accurate for new rows ----
    sections_to_delete = [
        existing_sections[sid]
        for sid in existing_sections
        if sid not in payload_section_ids
    ]
    for section in sections_to_delete:
        # Cascade takes care of questions + options.
        summary.questions_deleted += len(section.questions)
        for q in section.questions:
            summary.options_deleted += len(q.options)
        summary.sections_deleted += 1
        await db.delete(section)

    # Questions removed from a surviving section (or moved out and not present
    # anywhere in the payload) get deleted here.
    deleted_section_ids = {s.id for s in sections_to_delete}
    for qid, question in list(existing_questions.items()):
        if question.section_id in deleted_section_ids:
            # Already handled by cascade above.
            continue
        if qid not in payload_question_ids:
            summary.questions_deleted += 1
            summary.options_deleted += len(options_by_question.get(qid, []))
            await db.delete(question)

    await db.flush()

    # ---- Apply sections: creates, updates, orders --------------------------
    # We index position in the payload as the canonical `order` value.
    # Keep a mapping so nested questions can resolve their new section_id
    # even when the parent section is newly created.
    section_by_payload_index: dict[int, QuestionnaireSection] = {}

    for s_idx, s_in in enumerate(body.sections):
        title = sanitize_text(s_in.title.strip())
        if not title:
            raise HTTPException(status_code=400, detail="Section title cannot be empty")

        if s_in.id is None:
            section = QuestionnaireSection(
                version_id=draft_id,
                title=title,
                order=s_idx,
                is_ai_addendum=s_in.is_ai_addendum,
            )
            db.add(section)
            summary.sections_created += 1
        else:
            section = existing_sections[s_in.id]
            edited = False
            if section.title != title:
                section.title = title
                edited = True
            if section.is_ai_addendum != s_in.is_ai_addendum:
                section.is_ai_addendum = s_in.is_ai_addendum
                edited = True
            if section.order != s_idx:
                section.order = s_idx
                edited = True
            if edited:
                summary.sections_edited += 1

        section_by_payload_index[s_idx] = section

    # Flush so newly-created sections have IDs before we wire up questions.
    await db.flush()

    # ---- Apply questions ---------------------------------------------------
    # Resolve a starting question_number for new questions: MAX existing + 1.
    # Recompute after each new question so we don't collide on the composite
    # unique index (version_id, question_number).
    max_row = await db.execute(
        select(func.coalesce(func.max(Question.question_number), 0)).where(
            Question.version_id == draft_id
        )
    )
    next_question_number = int(max_row.scalar_one()) + 1

    for s_idx, s_in in enumerate(body.sections):
        section = section_by_payload_index[s_idx]

        for q_idx, q_in in enumerate(s_in.questions):
            text = sanitize_text(q_in.question_text.strip())
            if not text:
                raise HTTPException(
                    status_code=400, detail="Question text cannot be empty"
                )

            hint = sanitize_text(q_in.hint_text.strip()) if q_in.hint_text else None
            if hint == "":
                hint = None

            is_choice = _is_choice_type(q_in.response_type)
            allows_other = q_in.allows_other if is_choice else False

            is_new_question = q_in.id is None
            if is_new_question:
                question = Question(
                    version_id=draft_id,
                    section_id=section.id,
                    question_number=next_question_number,
                    question_key=_mint_question_key(),
                    question_text=text,
                    response_type=q_in.response_type,
                    allows_other=allows_other,
                    hint_text=hint,
                    is_required=q_in.is_required,
                    order=q_idx,
                )
                db.add(question)
                await db.flush()
                next_question_number += 1
                summary.questions_created += 1
                current_options: list[QuestionOption] = []
            else:
                question = existing_questions[q_in.id]
                current_options = options_by_question.get(question.id, [])
                edited = False

                if question.section_id != section.id:
                    question.section_id = section.id
                    edited = True
                if question.order != q_idx:
                    question.order = q_idx
                    edited = True
                if question.question_text != text:
                    question.question_text = text
                    edited = True
                if question.is_required != q_in.is_required:
                    question.is_required = q_in.is_required
                    edited = True
                if question.hint_text != hint:
                    question.hint_text = hint
                    edited = True

                # Response-type change mints a new key (refresh-matching).
                if question.response_type != q_in.response_type:
                    question.response_type = q_in.response_type
                    question.question_key = _mint_question_key()
                    summary.question_keys_minted += 1
                    warnings.append(
                        f"Q{question.question_number}: response type changed — "
                        "a new question_key was minted. This question will be "
                        "treated as new for refresh matching."
                    )
                    edited = True

                if question.allows_other != allows_other:
                    question.allows_other = allows_other
                    edited = True

                if edited:
                    summary.questions_edited += 1

            # ---- Options ---------------------------------------------------
            # For non-choice types, any existing options must go.
            if not is_choice:
                if current_options:
                    for opt in current_options:
                        summary.options_deleted += 1
                        await db.delete(opt)
                    await db.flush()
                continue

            # Choice type: reconcile options against the payload.
            existing_opt_by_id: dict[uuid.UUID, QuestionOption] = {
                o.id: o for o in current_options
            }
            payload_opt_ids: set[uuid.UUID] = set()
            for o_idx, o_in in enumerate(q_in.options):
                label = sanitize_text(o_in.label.strip())
                if not label:
                    raise HTTPException(
                        status_code=400, detail="Option label cannot be empty"
                    )
                if o_in.id is None:
                    db.add(
                        QuestionOption(
                            question_id=question.id,
                            label=label,
                            order=o_idx,
                        )
                    )
                    summary.options_created += 1
                else:
                    opt = existing_opt_by_id.get(o_in.id)
                    if opt is None or opt.question_id != question.id:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Option {o_in.id} does not belong to question "
                            f"{question.id}",
                        )
                    edited = False
                    if opt.label != label:
                        opt.label = label
                        edited = True
                    if opt.order != o_idx:
                        opt.order = o_idx
                        edited = True
                    if edited:
                        summary.options_edited += 1
                    payload_opt_ids.add(o_in.id)

            # Delete options no longer referenced.
            for oid, opt in existing_opt_by_id.items():
                if oid not in payload_opt_ids:
                    summary.options_deleted += 1
                    await db.delete(opt)

            await db.flush()

    # ---- Audit + return canonical state -----------------------------------
    await db.flush()

    if any(
        [
            summary.sections_created,
            summary.sections_edited,
            summary.sections_deleted,
            summary.questions_created,
            summary.questions_edited,
            summary.questions_deleted,
            summary.options_created,
            summary.options_edited,
            summary.options_deleted,
        ]
    ):
        await log_action(
            db,
            actor=admin,
            actor_type=ActorType.ADMIN,
            action="questionnaire.draft.saved",
            description=(
                "Draft saved "
                f"(sections +{summary.sections_created}/"
                f"~{summary.sections_edited}/"
                f"-{summary.sections_deleted}, "
                f"questions +{summary.questions_created}/"
                f"~{summary.questions_edited}/"
                f"-{summary.questions_deleted}, "
                f"options +{summary.options_created}/"
                f"~{summary.options_edited}/"
                f"-{summary.options_deleted})"
            ),
            metadata=summary.model_dump(),
        )

    refreshed = await _load_version_detail(db, draft_id)
    assert refreshed is not None  # we just held a reference

    return SaveDraftResponse(
        draft=QuestionnaireVersionDetail.model_validate(_serialize_version(refreshed)),
        summary=summary,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Renumber endpoint
# ---------------------------------------------------------------------------


@router.post("/draft/renumber")
async def renumber_draft(
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    draft_id = await _get_draft_id(db)
    changed_count = await renumber_version(db, draft_id)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="questionnaire.draft.renumbered",
        description=f"Draft renumbered ({changed_count} questions updated)",
        metadata={"changed_count": changed_count},
    )

    return {"ok": True, "changed_count": changed_count}
