"""Add previous_question_key to questions for diff pairing across key mints.

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-27

When the admin changes a question's response_type, the save handler mints a new
question_key (refresh-matching semantics). Recording the prior key on the row
itself lets the publish diff pair add↔remove entries precisely, instead of
relying on fragile text+section_title heuristics that break when text is also
edited in the same save.

No backfill: existing questions have no prior key.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "questions",
        sa.Column("previous_question_key", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("questions", "previous_question_key")
