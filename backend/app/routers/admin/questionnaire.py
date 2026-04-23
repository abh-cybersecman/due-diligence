"""Admin questionnaire (read-only listing) — Phase Q2.

Exposes three endpoints used by the admin Questionnaire editor UI:

- `GET /api/admin/questionnaire/versions`        — list all versions (summary)
- `GET /api/admin/questionnaire/versions/{id}`   — full version payload
- `GET /api/admin/questionnaire/draft`           — shortcut for the draft version

Writes (section/question CRUD, publish, discard) arrive in Phase Q3+.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.question import Question
from app.models.questionnaire_section import QuestionnaireSection
from app.models.questionnaire_version import QuestionnaireVersion
from app.schemas.questionnaire import (
    QuestionnaireVersionDetail,
    QuestionnaireVersionSummary,
)
from app.services.auth import get_admin_user

router = APIRouter(prefix="/questionnaire", tags=["admin-questionnaire"])


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

    return QuestionnaireVersionDetail.model_validate(_serialize(version))


@router.get("/versions/{version_id}", response_model=QuestionnaireVersionDetail)
async def get_version(
    version_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> QuestionnaireVersionDetail:
    version = await _load_version_detail(db, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Questionnaire version not found")

    return QuestionnaireVersionDetail.model_validate(_serialize(version))


def _serialize(version: QuestionnaireVersion) -> dict:
    """Build a dict with sections/questions/options pre-sorted by `order`.

    Relationship-level `order_by` already sorts sections and options, but
    Question.order sits on the section relationship; we re-sort defensively
    so the payload is always deterministic for the admin UI.
    """
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
                    {
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
                    for q in sorted(section.questions, key=lambda q: q.order)
                ],
            }
            for section in sorted(version.sections, key=lambda s: s.order)
        ],
    }
