"""Questionnaire-version service helpers.

This module hosts transaction-safe operations that can be called from both the
admin editor endpoints and the Phase Q4 publish flow. Nothing in here commits;
callers own the transaction.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.question import Question
from app.models.questionnaire_section import QuestionnaireSection


async def renumber_version(db: AsyncSession, version_id: uuid.UUID) -> int:
    """Assign sequential question_number = 1..N across a version.

    Iterates sections by ``order`` ascending, then questions within each
    section by ``order`` ascending, and rewrites ``question_number`` to be
    1-based and gap-free across the whole version.

    Does NOT commit. Returns the count of questions whose ``question_number``
    actually changed. Safe to call when no change is needed (returns 0).
    """
    result = await db.execute(
        select(QuestionnaireSection)
        .where(QuestionnaireSection.version_id == version_id)
        .order_by(QuestionnaireSection.order.asc())
        .options(selectinload(QuestionnaireSection.questions))
    )
    sections = result.scalars().all()

    ordered: list[Question] = []
    for section in sections:
        for q in sorted(section.questions, key=lambda x: x.order):
            ordered.append(q)

    if not ordered:
        return 0

    originals = [q.question_number for q in ordered]
    targets = list(range(1, len(ordered) + 1))

    if originals == targets:
        return 0

    # Two-phase update to avoid transient collisions on the composite unique
    # index (version_id, question_number): push every row into a non-
    # overlapping negative range, flush, then assign 1..N.
    offset = len(ordered) + 1
    for q in ordered:
        q.question_number = -(q.question_number + offset)
    await db.flush()

    for q, n in zip(ordered, targets):
        q.question_number = n
    await db.flush()

    return sum(1 for orig, new in zip(originals, targets) if orig != new)
