"""Admin questionnaire endpoints.

Phase Q2 added read-only listing of versions, sections, questions, and options.
Phase Q3 adds full write capability on the draft: section & question CRUD plus
batch reorder. All writes reject against non-draft versions, sanitize free-text
inputs, and produce audit-log entries.
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
    OptionInput,
    QuestionCreate,
    QuestionUpdate,
    QuestionWriteResponse,
    QuestionnaireVersionDetail,
    QuestionnaireVersionSummary,
    ReorderBody,
    SectionCreate,
    SectionDeleteResponse,
    SectionUpdate,
)
from app.services.audit import log_action
from app.services.auth import get_admin_user
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


async def _require_draft_version(
    db: AsyncSession, version_id: uuid.UUID
) -> QuestionnaireVersion:
    version = (
        await db.execute(
            select(QuestionnaireVersion).where(QuestionnaireVersion.id == version_id)
        )
    ).scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail="Questionnaire version not found")
    if not version.is_draft:
        raise HTTPException(status_code=400, detail="Only the draft version can be edited")
    return version


async def _load_draft_section(
    db: AsyncSession, section_id: uuid.UUID
) -> QuestionnaireSection:
    section = (
        await db.execute(
            select(QuestionnaireSection)
            .where(QuestionnaireSection.id == section_id)
            .options(selectinload(QuestionnaireSection.questions))
        )
    ).scalar_one_or_none()
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    await _require_draft_version(db, section.version_id)
    return section


async def _load_draft_question(
    db: AsyncSession, question_id: uuid.UUID
) -> Question:
    question = (
        await db.execute(
            select(Question)
            .where(Question.id == question_id)
            .options(selectinload(Question.options))
        )
    ).scalar_one_or_none()
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    await _require_draft_version(db, question.version_id)
    return question


def _mint_question_key() -> str:
    # token_urlsafe(6) yields 8 URL-safe characters.
    return f"q_{secrets.token_urlsafe(6)[:8]}"


async def _next_question_number(db: AsyncSession, version_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Question.question_number), 0)).where(
            Question.version_id == version_id
        )
    )
    return int(result.scalar_one()) + 1


async def _next_section_order(db: AsyncSession, version_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(QuestionnaireSection.order), -1)).where(
            QuestionnaireSection.version_id == version_id
        )
    )
    return int(result.scalar_one()) + 1


async def _next_question_order(db: AsyncSession, section_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(Question.order), -1)).where(
            Question.section_id == section_id
        )
    )
    return int(result.scalar_one()) + 1


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


def _choice_type(rt: ResponseType) -> bool:
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
    draft_id_row = await db.execute(
        select(QuestionnaireVersion.id).where(QuestionnaireVersion.is_draft.is_(True))
    )
    draft_id = draft_id_row.scalar_one_or_none()
    if draft_id is None:
        raise HTTPException(status_code=404, detail="No draft questionnaire version exists")

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
# Section write endpoints (Phase Q3)
# ---------------------------------------------------------------------------


@router.post("/draft/sections", status_code=201)
async def create_section(
    body: SectionCreate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    draft_id_row = await db.execute(
        select(QuestionnaireVersion.id).where(QuestionnaireVersion.is_draft.is_(True))
    )
    draft_id = draft_id_row.scalar_one_or_none()
    if draft_id is None:
        raise HTTPException(status_code=404, detail="No draft questionnaire version exists")

    title = sanitize_text(body.title.strip())
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")

    order = body.order if body.order is not None else await _next_section_order(db, draft_id)

    section = QuestionnaireSection(
        version_id=draft_id,
        title=title,
        order=order,
        is_ai_addendum=body.is_ai_addendum,
    )
    db.add(section)
    await db.flush()

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="questionnaire.draft.section.created",
        description=f"Section '{title}' created",
        metadata={
            "section_id": str(section.id),
            "title": title,
            "is_ai_addendum": body.is_ai_addendum,
            "order": order,
        },
    )

    return {
        "id": section.id,
        "version_id": section.version_id,
        "title": section.title,
        "order": section.order,
        "is_ai_addendum": section.is_ai_addendum,
        "questions": [],
    }


@router.patch("/draft/sections/{section_id}")
async def update_section(
    section_id: uuid.UUID,
    body: SectionUpdate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    section = await _load_draft_section(db, section_id)

    changed: dict = {}

    if body.title is not None:
        new_title = sanitize_text(body.title.strip())
        if not new_title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        if new_title != section.title:
            changed["title"] = {"from": section.title, "to": new_title}
            section.title = new_title

    if body.is_ai_addendum is not None and body.is_ai_addendum != section.is_ai_addendum:
        changed["is_ai_addendum"] = {
            "from": section.is_ai_addendum,
            "to": body.is_ai_addendum,
        }
        section.is_ai_addendum = body.is_ai_addendum

    if body.order is not None and body.order != section.order:
        changed["order"] = {"from": section.order, "to": body.order}
        section.order = body.order

    if changed:
        # If only title changed, describe as rename; otherwise generic "updated".
        if "title" in changed and len(changed) == 1:
            desc = f"Section renamed from '{changed['title']['from']}' to '{changed['title']['to']}'"
            action = "questionnaire.draft.section.renamed"
        else:
            desc = f"Section '{section.title}' updated"
            action = "questionnaire.draft.section.renamed"
        await log_action(
            db,
            actor=admin,
            actor_type=ActorType.ADMIN,
            action=action,
            description=desc,
            metadata={"section_id": str(section.id), "changed": changed},
        )

    return {
        "id": section.id,
        "version_id": section.version_id,
        "title": section.title,
        "order": section.order,
        "is_ai_addendum": section.is_ai_addendum,
    }


@router.delete("/draft/sections/{section_id}", response_model=SectionDeleteResponse)
async def delete_section(
    section_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> SectionDeleteResponse:
    section = await _load_draft_section(db, section_id)
    deleted_count = len(section.questions)
    title = section.title

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="questionnaire.draft.section.deleted",
        description=f"Section '{title}' deleted ({deleted_count} questions removed)",
        metadata={
            "section_id": str(section_id),
            "title": title,
            "deleted_questions": deleted_count,
        },
    )

    await db.delete(section)
    return SectionDeleteResponse(deleted_questions=deleted_count)


# ---------------------------------------------------------------------------
# Question write endpoints (Phase Q3)
# ---------------------------------------------------------------------------


def _normalize_options(options: list[OptionInput]) -> list[tuple[uuid.UUID | None, str]]:
    out: list[tuple[uuid.UUID | None, str]] = []
    for opt in options:
        label = sanitize_text(opt.label.strip())
        if not label:
            raise HTTPException(status_code=400, detail="Option label cannot be empty")
        out.append((opt.id, label))
    return out


@router.post("/draft/questions", status_code=201, response_model=QuestionWriteResponse)
async def create_question(
    body: QuestionCreate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> QuestionWriteResponse:
    section = await _load_draft_section(db, body.section_id)

    text = sanitize_text(body.question_text.strip())
    if not text:
        raise HTTPException(status_code=400, detail="Question text cannot be empty")

    hint = sanitize_text(body.hint_text.strip()) if body.hint_text else None
    if hint == "":
        hint = None

    allows_other = body.allows_other if _choice_type(body.response_type) else False

    initial_options: list[tuple[uuid.UUID | None, str]] = []
    if body.options:
        if not _choice_type(body.response_type):
            raise HTTPException(
                status_code=400,
                detail="Options only valid for single/multi choice questions",
            )
        initial_options = _normalize_options(body.options)

    question_number = await _next_question_number(db, section.version_id)
    order = await _next_question_order(db, section.id)

    question = Question(
        version_id=section.version_id,
        section_id=section.id,
        question_number=question_number,
        question_key=_mint_question_key(),
        question_text=text,
        response_type=body.response_type,
        allows_other=allows_other,
        hint_text=hint,
        is_required=body.is_required,
        order=order,
    )
    db.add(question)
    await db.flush()

    for idx, (_id, label) in enumerate(initial_options):
        db.add(
            QuestionOption(
                question_id=question.id,
                label=label,
                order=idx,
            )
        )
    await db.flush()
    # Re-fetch options to hydrate the relationship for the response payload.
    await db.refresh(question, attribute_names=["options"])

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="questionnaire.draft.question.created",
        description=f"Question Q{question_number} created in section '{section.title}'",
        metadata={
            "question_id": str(question.id),
            "question_key": question.question_key,
            "section_id": str(section.id),
            "response_type": body.response_type.value,
            "question_number": question_number,
        },
    )

    return QuestionWriteResponse(
        question=_serialize_question(question),  # type: ignore[arg-type]
        warnings=[],
    )


@router.patch("/draft/questions/{question_id}", response_model=QuestionWriteResponse)
async def update_question(
    question_id: uuid.UUID,
    body: QuestionUpdate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> QuestionWriteResponse:
    question = await _load_draft_question(db, question_id)

    changed: dict = {}
    warnings: list[str] = []

    if body.section_id is not None and body.section_id != question.section_id:
        # Moving to another section must also be within the same draft version.
        new_section = await _load_draft_section(db, body.section_id)
        changed["section_id"] = {
            "from": str(question.section_id),
            "to": str(new_section.id),
        }
        question.section_id = new_section.id
        # Place at end of target section.
        question.order = await _next_question_order(db, new_section.id)

    if body.question_text is not None:
        text = sanitize_text(body.question_text.strip())
        if not text:
            raise HTTPException(status_code=400, detail="Question text cannot be empty")
        if text != question.question_text:
            changed["question_text"] = {"from": question.question_text, "to": text}
            question.question_text = text

    if body.is_required is not None and body.is_required != question.is_required:
        changed["is_required"] = {"from": question.is_required, "to": body.is_required}
        question.is_required = body.is_required

    if body.hint_text is not None:
        new_hint = sanitize_text(body.hint_text.strip()) if body.hint_text else None
        if new_hint == "":
            new_hint = None
        if new_hint != question.hint_text:
            changed["hint_text"] = {"from": question.hint_text, "to": new_hint}
            question.hint_text = new_hint

    response_type_changed = False
    if body.response_type is not None and body.response_type != question.response_type:
        old_key = question.question_key
        old_type = question.response_type.value if isinstance(question.response_type, ResponseType) else str(question.response_type)
        changed["response_type"] = {
            "from": old_type,
            "to": body.response_type.value,
        }
        question.response_type = body.response_type
        # Force new key — the question is semantically new for refresh-matching.
        new_key = _mint_question_key()
        question.question_key = new_key
        changed["question_key"] = {"from": old_key, "to": new_key}
        warnings.append(
            "Response type changed — a new question_key was minted. "
            "This question will be treated as new for refresh matching."
        )
        response_type_changed = True

    # allows_other only meaningful for choice types — after any response_type
    # change, re-evaluate compatibility.
    effective_type = question.response_type
    if body.allows_other is not None:
        new_allows = body.allows_other if _choice_type(effective_type) else False
        if new_allows != question.allows_other:
            changed["allows_other"] = {"from": question.allows_other, "to": new_allows}
            question.allows_other = new_allows
    elif response_type_changed and not _choice_type(effective_type) and question.allows_other:
        changed["allows_other"] = {"from": True, "to": False}
        question.allows_other = False

    # Auto-clear options when leaving a choice-type response to non-choice.
    if response_type_changed and not _choice_type(effective_type) and question.options:
        for existing in list(question.options):
            await db.delete(existing)
        changed["options_cleared"] = True

    # Options: full replacement when provided.
    if body.options is not None:
        if not _choice_type(effective_type):
            if body.options:
                raise HTTPException(
                    status_code=400,
                    detail="Options only valid for single/multi choice questions",
                )
            # Type is non-choice and caller sent an empty list — clear any stale
            # options from a prior choice-type incarnation.
            for existing in list(question.options):
                await db.delete(existing)
        else:
            normalized = _normalize_options(body.options)
            existing_by_id = {opt.id: opt for opt in question.options}
            kept_ids: set[uuid.UUID] = set()
            new_list: list[QuestionOption] = []

            for idx, (opt_id, label) in enumerate(normalized):
                if opt_id is not None and opt_id in existing_by_id:
                    opt = existing_by_id[opt_id]
                    opt.label = label
                    opt.order = idx
                    kept_ids.add(opt_id)
                    new_list.append(opt)
                else:
                    opt = QuestionOption(
                        question_id=question.id,
                        label=label,
                        order=idx,
                    )
                    db.add(opt)
                    new_list.append(opt)

            for opt_id, opt in existing_by_id.items():
                if opt_id not in kept_ids:
                    await db.delete(opt)

            await db.flush()
            changed["options"] = {
                "count": len(new_list),
                "labels": [label for _, label in normalized],
            }

    # Re-hydrate options collection for the response payload.
    await db.flush()
    await db.refresh(question, attribute_names=["options"])

    if changed:
        await log_action(
            db,
            actor=admin,
            actor_type=ActorType.ADMIN,
            action="questionnaire.draft.question.edited",
            description=f"Question Q{question.question_number} edited",
            metadata={
                "question_id": str(question.id),
                "question_key": question.question_key,
                "changed": changed,
            },
        )

    return QuestionWriteResponse(
        question=_serialize_question(question),  # type: ignore[arg-type]
        warnings=warnings,
    )


@router.delete("/draft/questions/{question_id}", status_code=204)
async def delete_question(
    question_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    question = await _load_draft_question(db, question_id)

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="questionnaire.draft.question.deleted",
        description=f"Question Q{question.question_number} deleted",
        metadata={
            "question_id": str(question.id),
            "question_key": question.question_key,
            "question_number": question.question_number,
            "section_id": str(question.section_id),
        },
    )

    await db.delete(question)


# ---------------------------------------------------------------------------
# Reorder endpoint (Phase Q3)
# ---------------------------------------------------------------------------


@router.post("/draft/reorder")
async def reorder(
    body: ReorderBody,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    if not body.section_orders and not body.question_orders:
        return {"ok": True, "section_count": 0, "question_count": 0}

    # Resolve draft version id once.
    draft_id_row = await db.execute(
        select(QuestionnaireVersion.id).where(QuestionnaireVersion.is_draft.is_(True))
    )
    draft_id = draft_id_row.scalar_one_or_none()
    if draft_id is None:
        raise HTTPException(status_code=404, detail="No draft questionnaire version exists")

    section_count = 0
    question_count = 0

    if body.section_orders:
        ids = [item.id for item in body.section_orders]
        rows = (
            await db.execute(
                select(QuestionnaireSection).where(QuestionnaireSection.id.in_(ids))
            )
        ).scalars().all()
        by_id = {row.id: row for row in rows}
        for item in body.section_orders:
            section = by_id.get(item.id)
            if section is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Section {item.id} not found",
                )
            if section.version_id != draft_id:
                raise HTTPException(
                    status_code=400,
                    detail="Only the draft version can be edited",
                )
            section.order = item.order
            section_count += 1

    if body.question_orders:
        all_q_ids: list[uuid.UUID] = []
        for items in body.question_orders.values():
            all_q_ids.extend(item.id for item in items)
        if all_q_ids:
            rows = (
                await db.execute(select(Question).where(Question.id.in_(all_q_ids)))
            ).scalars().all()
            q_by_id = {row.id: row for row in rows}
            for section_id_key, items in body.question_orders.items():
                for item in items:
                    question = q_by_id.get(item.id)
                    if question is None:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Question {item.id} not found",
                        )
                    if question.version_id != draft_id:
                        raise HTTPException(
                            status_code=400,
                            detail="Only the draft version can be edited",
                        )
                    # Allow re-homing via reorder: accept either the existing
                    # section or the key provided.
                    if question.section_id != section_id_key:
                        # Verify the target section belongs to the draft too.
                        target = (
                            await db.execute(
                                select(QuestionnaireSection).where(
                                    QuestionnaireSection.id == section_id_key
                                )
                            )
                        ).scalar_one_or_none()
                        if target is None or target.version_id != draft_id:
                            raise HTTPException(
                                status_code=400,
                                detail="Target section does not belong to the draft",
                            )
                        question.section_id = section_id_key
                    question.order = item.order
                    question_count += 1

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="questionnaire.draft.reordered",
        description=(
            f"Reorder applied "
            f"({section_count} sections, {question_count} questions)"
        ),
        metadata={
            "section_count": section_count,
            "question_count": question_count,
        },
    )

    return {
        "ok": True,
        "section_count": section_count,
        "question_count": question_count,
    }
