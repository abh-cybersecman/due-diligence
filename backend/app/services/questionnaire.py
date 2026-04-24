"""Questionnaire-version service helpers.

This module hosts transaction-safe operations that can be called from both the
admin editor endpoints and the Phase Q4 publish flow. Nothing in here commits;
callers own the transaction.
"""
from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.question import Question
from app.models.question_option import QuestionOption
from app.models.questionnaire_section import QuestionnaireSection
from app.models.questionnaire_version import QuestionnaireVersion


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


async def load_version_with_contents(
    db: AsyncSession, version_id: uuid.UUID
) -> QuestionnaireVersion | None:
    """Load a version with its sections, questions, and options eagerly loaded."""
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


async def clone_version_contents(
    db: AsyncSession,
    source_version_id: uuid.UUID,
    target_version_id: uuid.UUID,
) -> None:
    """Copy every section/question/option from source to target.

    Fresh UUIDs for every row; ``question_key`` values copy verbatim so
    refresh matching works across the generated draft. Question numbers and
    order fields copy as-is. Does not commit — caller owns the transaction.
    """
    source = await load_version_with_contents(db, source_version_id)
    if source is None:
        raise ValueError(f"Source version {source_version_id} not found")

    for section in sorted(source.sections, key=lambda s: s.order):
        new_section = QuestionnaireSection(
            version_id=target_version_id,
            title=section.title,
            order=section.order,
            is_ai_addendum=section.is_ai_addendum,
        )
        db.add(new_section)
        await db.flush()

        for question in sorted(section.questions, key=lambda q: q.order):
            new_question = Question(
                version_id=target_version_id,
                section_id=new_section.id,
                question_number=question.question_number,
                question_key=question.question_key,
                question_text=question.question_text,
                response_type=question.response_type,
                allows_other=question.allows_other,
                hint_text=question.hint_text,
                is_required=question.is_required,
                order=question.order,
            )
            db.add(new_question)
            await db.flush()

            for opt in sorted(question.options, key=lambda o: o.order):
                db.add(
                    QuestionOption(
                        question_id=new_question.id,
                        label=opt.label,
                        order=opt.order,
                    )
                )

    await db.flush()


def next_minor_version_label(current_label: str) -> str:
    """v1.0 → v1.1, v2.3 → v2.4. Falls back to `<label>.1` on unexpected format."""
    m = re.match(r"^v(\d+)\.(\d+)$", current_label)
    if not m:
        return f"{current_label}.1"
    major, minor = int(m.group(1)), int(m.group(2))
    return f"v{major}.{minor + 1}"
