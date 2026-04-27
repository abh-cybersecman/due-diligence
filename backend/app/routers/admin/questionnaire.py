"""Admin questionnaire endpoints.

Phase Q2 added read-only listing of versions, sections, questions, and options.
Phase Q3 originally exposed a set of per-mutation endpoints; the editor has
since moved to a single batched save where the full draft state is posted and
the backend reconciles it against the current DB. The per-mutation endpoints
were removed so the two code paths cannot drift.
"""
from __future__ import annotations

import re
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models.audit_log import ActorType
from app.models.question import Question, ResponseType
from app.models.question_option import QuestionOption
from app.models.questionnaire_section import QuestionnaireSection
from app.models.questionnaire_version import QuestionnaireVersion
from app.schemas.questionnaire import (
    DiscardDraftResponse,
    DraftDiff,
    PublishDraftBody,
    PublishDraftResponse,
    QuestionnaireVersionDetail,
    QuestionnaireVersionSummary,
    SaveDraftBody,
    SaveDraftResponse,
    SaveDraftSummary,
    VERSION_LABEL_REGEX,
)
from app.services.audit import log_action
from app.services.auth import get_admin_user, verify_password
from app.services.questionnaire import (
    clone_version_contents,
    load_version_with_contents,
    next_minor_version_label,
    renumber_version,
)
from app.utils.sanitize import sanitize_text

router = APIRouter(prefix="/questionnaire", tags=["admin-questionnaire"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_version_detail(
    db: AsyncSession, version_id: uuid.UUID
) -> QuestionnaireVersion | None:
    return await load_version_with_contents(db, version_id)


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
    response_type_change_mints: list[dict[str, str]] = []

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
                summary.question_keys_minted += 1
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
                    old_key = question.question_key
                    question.response_type = q_in.response_type
                    question.question_key = _mint_question_key()
                    summary.question_keys_minted += 1
                    response_type_change_mints.append({
                        "question_id": str(question.id),
                        "old_key": old_key,
                        "new_key": question.question_key,
                    })
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
        metadata = summary.model_dump()
        if response_type_change_mints:
            metadata["response_type_change_mints"] = response_type_change_mints
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
            metadata=metadata,
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


# ---------------------------------------------------------------------------
# Diff / Publish / Discard (Phase Q4)
# ---------------------------------------------------------------------------


def _question_snapshot(q: Question) -> dict:
    return {
        "text": q.question_text,
        "response_type": q.response_type,
        "is_required": q.is_required,
        "allows_other": q.allows_other,
        "hint_text": q.hint_text,
        "options": [o.label for o in sorted(q.options, key=lambda o: o.order)],
    }


def _compute_diff(
    draft: QuestionnaireVersion,
    current: QuestionnaireVersion | None,
) -> dict:
    draft_sections = sorted(draft.sections, key=lambda s: s.order)
    pub_sections = (
        sorted(current.sections, key=lambda s: s.order) if current else []
    )

    # --- Section diff: match by title first, then by question_key overlap ---
    draft_titles = {s.title for s in draft_sections}
    pub_titles = {s.title for s in pub_sections}

    draft_unmatched = [s for s in draft_sections if s.title not in pub_titles]
    pub_unmatched = [s for s in pub_sections if s.title not in draft_titles]

    renamed: list[dict] = []
    used_pub_ids: set[uuid.UUID] = set()
    used_draft_ids: set[uuid.UUID] = set()

    for ds in draft_unmatched:
        ds_keys = {q.question_key for q in ds.questions}
        if not ds_keys:
            continue
        best = None
        best_overlap = 0
        for ps in pub_unmatched:
            if ps.id in used_pub_ids:
                continue
            ps_keys = {q.question_key for q in ps.questions}
            overlap = len(ds_keys & ps_keys)
            if overlap > best_overlap:
                best = ps
                best_overlap = overlap
        if best is not None and best_overlap >= 1:
            renamed.append({"before": best.title, "after": ds.title})
            used_pub_ids.add(best.id)
            used_draft_ids.add(ds.id)

    added_sections = [
        {"title": s.title, "is_ai_addendum": s.is_ai_addendum}
        for s in draft_unmatched
        if s.id not in used_draft_ids
    ]
    removed_sections = [
        {"title": s.title} for s in pub_unmatched if s.id not in used_pub_ids
    ]

    # --- Question diff: match by question_key ---
    draft_q: dict[str, tuple[QuestionnaireSection, Question]] = {}
    for s in draft_sections:
        for q in s.questions:
            draft_q[q.question_key] = (s, q)
    pub_q: dict[str, tuple[QuestionnaireSection, Question]] = {}
    for s in pub_sections:
        for q in s.questions:
            pub_q[q.question_key] = (s, q)

    added_questions: list[dict] = []
    removed_questions: list[dict] = []
    edited_questions: list[dict] = []
    unchanged_count = 0

    for key, (ds, dq) in draft_q.items():
        if key not in pub_q:
            added_questions.append(
                {
                    "question_key": key,
                    "question_text": dq.question_text,
                    "section_title": ds.title,
                    "response_type": dq.response_type,
                    "is_required": dq.is_required,
                }
            )
        else:
            ps, pq = pub_q[key]
            before = _question_snapshot(pq)
            after = _question_snapshot(dq)
            if before == after:
                unchanged_count += 1
            else:
                edited_questions.append(
                    {
                        "question_key": key,
                        "section_title": ds.title,
                        "before": before,
                        "after": after,
                    }
                )

    for key, (ps, pq) in pub_q.items():
        if key not in draft_q:
            removed_questions.append(
                {
                    "question_key": key,
                    "question_text": pq.question_text,
                    "section_title": ps.title,
                }
            )

    # --- Non-sequential question-number detection ---
    all_numbers = [q.question_number for s in draft_sections for q in s.questions]
    has_non_sequential = bool(all_numbers) and sorted(all_numbers) != list(
        range(1, len(all_numbers) + 1)
    )

    current_label = current.version_label if current else None
    next_label = (
        next_minor_version_label(current_label) if current_label else "v1.0"
    )

    return {
        "from_version_label": current_label,
        "to_version_label": next_label,
        "sections": {
            "added": added_sections,
            "removed": removed_sections,
            "renamed": renamed,
        },
        "questions": {
            "added": added_questions,
            "removed": removed_questions,
            "edited": edited_questions,
            "unchanged_count": unchanged_count,
        },
        "has_non_sequential_numbers": has_non_sequential,
    }


async def _get_current_version(db: AsyncSession) -> QuestionnaireVersion | None:
    result = await db.execute(
        select(QuestionnaireVersion).where(
            QuestionnaireVersion.is_current.is_(True)
        )
    )
    return result.scalar_one_or_none()


@router.get("/draft/diff", response_model=DraftDiff)
async def get_draft_diff(
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> DraftDiff:
    draft_id = await _get_draft_id(db)
    draft = await _load_version_detail(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft questionnaire version not found")

    current_row = await _get_current_version(db)
    current = (
        await _load_version_detail(db, current_row.id) if current_row else None
    )

    payload = _compute_diff(draft, current)
    return DraftDiff.model_validate(payload)


def _diff_summary(payload: dict) -> dict:
    return {
        "sections_added": len(payload["sections"]["added"]),
        "sections_removed": len(payload["sections"]["removed"]),
        "sections_renamed": len(payload["sections"]["renamed"]),
        "questions_added": len(payload["questions"]["added"]),
        "questions_removed": len(payload["questions"]["removed"]),
        "questions_edited": len(payload["questions"]["edited"]),
        "unchanged_count": payload["questions"]["unchanged_count"],
    }


@router.post("/draft/publish", response_model=PublishDraftResponse)
async def publish_draft(
    body: PublishDraftBody,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> PublishDraftResponse:
    changelog = body.changelog.strip()
    if len(changelog) < 20:
        raise HTTPException(
            status_code=400,
            detail="Changelog must be at least 20 characters",
        )

    if not settings.admin_password_hash or not verify_password(
        body.password, settings.admin_password_hash
    ):
        # Generic 403 — do not leak which credential failed.
        raise HTTPException(status_code=403, detail="Incorrect password")

    # --- Resolve version label ---------------------------------------------
    current_row = await _get_current_version(db)
    draft_id = await _get_draft_id(db)

    async def _label_collides(candidate: str) -> bool:
        """True if any version OTHER than the draft already uses this label."""
        res = await db.execute(
            select(QuestionnaireVersion.id).where(
                QuestionnaireVersion.version_label == candidate,
                QuestionnaireVersion.id != draft_id,
            )
        )
        return res.scalar_one_or_none() is not None

    if body.version_label is not None:
        candidate = body.version_label.strip()
        if not re.match(VERSION_LABEL_REGEX, candidate):
            raise HTTPException(
                status_code=400,
                detail="Version label must match pattern vMAJOR.MINOR (e.g. v2.0)",
            )
        if await _label_collides(candidate):
            raise HTTPException(
                status_code=400, detail="Version label already exists"
            )
        new_label = candidate
    elif current_row is not None:
        new_label = next_minor_version_label(current_row.version_label)
        # Guard against collision with an archived version that already took
        # the computed minor bump (unlikely, but possible after manual overrides).
        if await _label_collides(new_label):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Auto-incremented label {new_label!r} already exists — "
                    "please override the version label."
                ),
            )
    else:
        new_label = "v1.0"

    # --- Load draft + capture diff for audit metadata ----------------------
    draft = await _load_version_detail(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft questionnaire version not found")

    current = (
        await _load_version_detail(db, current_row.id) if current_row else None
    )
    diff_payload = _compute_diff(draft, current)
    summary = _diff_summary(diff_payload)

    from_version_label = current_row.version_label if current_row else None

    # --- Publish transaction -----------------------------------------------
    # get_db() wraps the whole request in a transaction; if any step below
    # raises, the session rolls back and nothing is committed.

    # 1. Renumber the draft in place.
    await renumber_version(db, draft_id)

    # 2. Flip old current's flag OFF *before* promoting the draft so the
    #    partial unique index `only_one_current` isn't transiently violated.
    if current_row is not None:
        current_row.is_current = False
        await db.flush()

    # 3. Promote the draft: clear is_draft, set is_current, metadata.
    draft.is_draft = False
    draft.is_current = True
    draft.published_at = datetime.now(timezone.utc)
    draft.changelog = changelog
    draft.version_label = new_label
    await db.flush()

    # 4. Create a fresh draft cloned from the just-published version. The
    #    draft's label previews the *next* auto-incremented version; the
    #    admin can still override at the next publish.
    new_draft_label = next_minor_version_label(new_label)
    # Ensure uniqueness in case an archived version already uses that label.
    probe_label = new_draft_label
    suffix = 1
    while True:
        existing = await db.execute(
            select(QuestionnaireVersion.id).where(
                QuestionnaireVersion.version_label == probe_label
            )
        )
        if existing.scalar_one_or_none() is None:
            break
        suffix += 1
        probe_label = f"{new_draft_label}-{suffix}"
    new_draft = QuestionnaireVersion(
        version_label=probe_label,
        is_current=False,
        is_draft=True,
        published_at=None,
        changelog=None,
    )
    db.add(new_draft)
    await db.flush()

    await clone_version_contents(db, draft_id, new_draft.id)

    # 5. Audit log.
    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="questionnaire.published",
        description=(
            f"Published questionnaire {new_label} "
            f"(was {from_version_label or 'none'})"
        ),
        metadata={
            "from_version": from_version_label,
            "to_version": new_label,
            "changelog": changelog,
            "diff_summary": summary,
        },
    )

    # 6. Load canonical state for response.
    published_reloaded = await _load_version_detail(db, draft_id)
    new_draft_reloaded = await _load_version_detail(db, new_draft.id)
    assert published_reloaded is not None and new_draft_reloaded is not None

    return PublishDraftResponse(
        new_version=QuestionnaireVersionDetail.model_validate(
            _serialize_version(published_reloaded)
        ),
        new_draft=QuestionnaireVersionDetail.model_validate(
            _serialize_version(new_draft_reloaded)
        ),
    )


@router.post("/draft/discard", response_model=DiscardDraftResponse)
async def discard_draft(
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> DiscardDraftResponse:
    draft_id = await _get_draft_id(db)
    draft = await _load_version_detail(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft questionnaire version not found")

    current_row = await _get_current_version(db)
    if current_row is None:
        raise HTTPException(
            status_code=400,
            detail="No published version exists to restore the draft from",
        )

    destroyed_section_count = len(draft.sections)
    destroyed_question_count = sum(len(s.questions) for s in draft.sections)

    # Delete all sections (cascade takes out questions + options).
    for section in list(draft.sections):
        await db.delete(section)
    await db.flush()

    # Re-clone from the current published version.
    await clone_version_contents(db, current_row.id, draft_id)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="questionnaire.draft.discarded",
        description=(
            f"Draft discarded and restored from {current_row.version_label} "
            f"({destroyed_question_count} questions across "
            f"{destroyed_section_count} sections wiped)"
        ),
        metadata={
            "restored_from_version_label": current_row.version_label,
            "destroyed_section_count": destroyed_section_count,
            "destroyed_question_count": destroyed_question_count,
        },
    )

    refreshed = await _load_version_detail(db, draft_id)
    assert refreshed is not None
    return DiscardDraftResponse(
        draft=QuestionnaireVersionDetail.model_validate(
            _serialize_version(refreshed)
        )
    )
