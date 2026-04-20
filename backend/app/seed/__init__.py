import json
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.question import Question, ResponseType


async def seed_questions(db: AsyncSession) -> None:
    result = await db.execute(select(Question).limit(1))
    if result.scalar_one_or_none() is not None:
        return

    seed_path = Path(__file__).parent / "questions.json"
    questions_data = json.loads(seed_path.read_text())

    for q in questions_data:
        question = Question(
            id=uuid.uuid4(),
            question_number=q["question_number"],
            section=q["section"],
            question_text=q["question_text"],
            response_type=ResponseType(q["response_type"]),
            is_ai_addendum=q["is_ai_addendum"],
            is_required=q["is_required"],
            order=q["order"],
        )
        db.add(question)

    await db.commit()
