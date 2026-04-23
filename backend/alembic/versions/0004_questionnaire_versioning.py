"""Questionnaire versioning: new tables, FK-ify questions, pin engagements.

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-23

Steps (see CLAUDE-questionnaire-versioning.md → Alembic Migration Plan):
  1. Create `questionnaire_versions`; insert v1.0 row.
  2. Create `questionnaire_sections`; backfill one row per distinct
     `questions.section` string, all linked to v1.0.
  3. Alter `questions`: add version_id/section_id/question_key/allows_other/
     hint_text, backfill, drop section + is_ai_addendum, swap unique index.
  4. Create `question_options` (no data to backfill).
  5. Alter `engagements`: add questionnaire_version_id/parent_engagement_id/
     revision_number; backfill pinned version.
  6. Alter `responses`: add other_text.
  7. Clone v1.0 into a `v1.1` draft (same question_keys, fresh UUIDs).
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _seed_legacy_questions_if_empty(bind) -> None:
    """First-time install path: populate `questions` from seed/questions.json
    in its legacy shape (section String, is_ai_addendum Boolean). The normal
    backfill logic below then takes it from there — so the migration works
    identically whether the DB already had rows (upgrade) or not (fresh)."""
    count = bind.execute(sa.text("SELECT COUNT(*) FROM questions")).scalar()
    if count and count > 0:
        return

    # alembic/versions/0004_... → up two levels to /app, then into app/seed/
    seed_path = Path(__file__).resolve().parents[2] / "app" / "seed" / "questions.json"
    rows = json.loads(seed_path.read_text())
    for q in rows:
        bind.execute(
            sa.text(
                "INSERT INTO questions "
                '(id, question_number, section, question_text, response_type, '
                ' is_ai_addendum, is_required, "order") '
                "VALUES (:id, :qn, :section, :qt, :rt, :ai, :req, :ord)"
            ),
            {
                "id": str(uuid.uuid4()),
                "qn": q["question_number"],
                "section": q["section"],
                "qt": q["question_text"],
                "rt": q["response_type"],
                "ai": q["is_ai_addendum"],
                "req": q["is_required"],
                "ord": q["order"],
            },
        )


def upgrade() -> None:
    bind = op.get_bind()

    # Fresh-install path: seed legacy-shape questions first, so the standard
    # backfill pipeline below handles them the same way it would an upgrade.
    _seed_legacy_questions_if_empty(bind)

    # ------------------------------------------------------------------
    # 1. questionnaire_versions + v1.0 row
    # ------------------------------------------------------------------
    op.create_table(
        "questionnaire_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("version_label", sa.String(20), unique=True, nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_draft", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("changelog", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.execute(
        "CREATE UNIQUE INDEX only_one_draft ON questionnaire_versions (is_draft) "
        "WHERE is_draft = true"
    )
    op.execute(
        "CREATE UNIQUE INDEX only_one_current ON questionnaire_versions (is_current) "
        "WHERE is_current = true"
    )

    v1_id = str(uuid.uuid4())
    bind.execute(
        sa.text(
            "INSERT INTO questionnaire_versions "
            "(id, version_label, is_current, is_draft, published_at, changelog, "
            " created_at, updated_at) "
            "VALUES (:id, 'v1.0', true, false, NOW(), 'Initial seed', NOW(), NOW())"
        ),
        {"id": v1_id},
    )

    # ------------------------------------------------------------------
    # 2. questionnaire_sections + backfill from distinct question.section
    # ------------------------------------------------------------------
    op.create_table(
        "questionnaire_sections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("questionnaire_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("is_ai_addendum", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index(
        "ix_questionnaire_sections_version_id",
        "questionnaire_sections",
        ["version_id"],
    )

    rows = bind.execute(
        sa.text(
            'SELECT section, MIN("order") AS min_order, '
            "       COUNT(DISTINCT is_ai_addendum) AS variants, "
            "       BOOL_OR(is_ai_addendum) AS any_ai "
            "FROM questions "
            "GROUP BY section "
            'ORDER BY MIN("order")'
        )
    ).fetchall()

    section_title_to_id: dict[str, str] = {}
    for idx, row in enumerate(rows, start=1):
        title, _min_order, variants, any_ai = row
        if variants and variants > 1:
            raise RuntimeError(
                f"Migration 0004: section '{title}' has mixed is_ai_addendum "
                "values; refuse to backfill an ambiguous section flag."
            )
        sid = str(uuid.uuid4())
        section_title_to_id[title] = sid
        bind.execute(
            sa.text(
                "INSERT INTO questionnaire_sections "
                '(id, version_id, title, "order", is_ai_addendum) '
                "VALUES (:id, :vid, :title, :ord, :ai)"
            ),
            {"id": sid, "vid": v1_id, "title": title, "ord": idx, "ai": bool(any_ai)},
        )

    # ------------------------------------------------------------------
    # 3. questions: add cols, backfill, drop old cols, swap unique index
    # ------------------------------------------------------------------
    op.add_column("questions", sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("questions", sa.Column("section_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("questions", sa.Column("question_key", sa.String(100), nullable=True))
    op.add_column(
        "questions",
        sa.Column("allows_other", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("questions", sa.Column("hint_text", sa.Text(), nullable=True))

    bind.execute(sa.text("UPDATE questions SET version_id = :vid"), {"vid": v1_id})
    for title, sid in section_title_to_id.items():
        bind.execute(
            sa.text("UPDATE questions SET section_id = :sid WHERE section = :title"),
            {"sid": sid, "title": title},
        )
    bind.execute(sa.text("UPDATE questions SET question_key = 'q_' || question_number::text"))

    op.drop_column("questions", "section")
    op.drop_column("questions", "is_ai_addendum")

    # Old implicit unique on question_number → drop, replace with composite
    op.execute("ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_question_number_key")
    op.create_unique_constraint(
        "uq_questions_version_id_question_number",
        "questions",
        ["version_id", "question_number"],
    )
    op.create_foreign_key(
        "fk_questions_version_id",
        "questions",
        "questionnaire_versions",
        ["version_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_questions_section_id",
        "questions",
        "questionnaire_sections",
        ["section_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_questions_version_id", "questions", ["version_id"])
    op.create_index("ix_questions_section_id", "questions", ["section_id"])
    op.alter_column("questions", "version_id", nullable=False)
    op.alter_column("questions", "section_id", nullable=False)
    op.alter_column("questions", "question_key", nullable=False)

    # ------------------------------------------------------------------
    # 4. question_options (empty — TEXT/FILE_UPLOAD seed has no options)
    # ------------------------------------------------------------------
    op.create_table(
        "question_options",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "question_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("questions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(500), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
    )
    op.create_index("ix_question_options_question_id", "question_options", ["question_id"])

    # ------------------------------------------------------------------
    # 5. engagements: add cols, backfill pinned version, mark NOT NULL
    # ------------------------------------------------------------------
    op.add_column(
        "engagements",
        sa.Column("questionnaire_version_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "engagements",
        sa.Column("parent_engagement_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "engagements",
        sa.Column("revision_number", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )

    bind.execute(
        sa.text("UPDATE engagements SET questionnaire_version_id = :vid"),
        {"vid": v1_id},
    )
    op.alter_column("engagements", "questionnaire_version_id", nullable=False)
    op.create_foreign_key(
        "fk_engagements_questionnaire_version_id",
        "engagements",
        "questionnaire_versions",
        ["questionnaire_version_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_engagements_parent_engagement_id",
        "engagements",
        "engagements",
        ["parent_engagement_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ------------------------------------------------------------------
    # 6. responses: add other_text
    # ------------------------------------------------------------------
    op.add_column("responses", sa.Column("other_text", sa.Text(), nullable=True))

    # ------------------------------------------------------------------
    # 7. Clone v1.0 → v1.1 draft
    # ------------------------------------------------------------------
    draft_id = str(uuid.uuid4())
    bind.execute(
        sa.text(
            "INSERT INTO questionnaire_versions "
            "(id, version_label, is_current, is_draft, published_at, changelog, "
            " created_at, updated_at) "
            "VALUES (:id, 'v1.1', false, true, NULL, NULL, NOW(), NOW())"
        ),
        {"id": draft_id},
    )

    src_sections = bind.execute(
        sa.text(
            'SELECT id, title, "order", is_ai_addendum '
            "FROM questionnaire_sections WHERE version_id = :vid "
            'ORDER BY "order"'
        ),
        {"vid": v1_id},
    ).fetchall()

    for src_sid, title, sec_order, sec_ai in src_sections:
        new_sid = str(uuid.uuid4())
        bind.execute(
            sa.text(
                "INSERT INTO questionnaire_sections "
                '(id, version_id, title, "order", is_ai_addendum) '
                "VALUES (:id, :vid, :title, :ord, :ai)"
            ),
            {"id": new_sid, "vid": draft_id, "title": title, "ord": sec_order, "ai": sec_ai},
        )

        src_qs = bind.execute(
            sa.text(
                'SELECT question_number, question_key, question_text, response_type, '
                '       is_required, "order", allows_other, hint_text '
                "FROM questions "
                "WHERE version_id = :vid AND section_id = :sid "
                'ORDER BY "order"'
            ),
            {"vid": v1_id, "sid": src_sid},
        ).fetchall()

        for qr in src_qs:
            bind.execute(
                sa.text(
                    "INSERT INTO questions "
                    "(id, version_id, section_id, question_number, question_key, "
                    ' question_text, response_type, is_required, "order", '
                    " allows_other, hint_text) "
                    "VALUES (:id, :vid, :sid, :qn, :qk, :qt, :rt, :req, :ord, "
                    "        :ao, :ht)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "vid": draft_id,
                    "sid": new_sid,
                    "qn": qr[0],
                    "qk": qr[1],
                    "qt": qr[2],
                    "rt": qr[3],
                    "req": qr[4],
                    "ord": qr[5],
                    "ao": qr[6],
                    "ht": qr[7],
                },
            )


def downgrade() -> None:
    bind = op.get_bind()

    # 6. responses.other_text
    op.drop_column("responses", "other_text")

    # 5. engagements FKs + new columns
    op.drop_constraint(
        "fk_engagements_parent_engagement_id", "engagements", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_engagements_questionnaire_version_id", "engagements", type_="foreignkey"
    )
    op.drop_column("engagements", "revision_number")
    op.drop_column("engagements", "parent_engagement_id")
    op.drop_column("engagements", "questionnaire_version_id")

    # Find v1.0 id (we only keep v1.0's questions on rollback)
    v1_row = bind.execute(
        sa.text("SELECT id FROM questionnaire_versions WHERE version_label = 'v1.0'")
    ).fetchone()
    v1_id = v1_row[0] if v1_row else None

    # 3. Restore questions.section (String) + questions.is_ai_addendum
    op.add_column(
        "questions",
        sa.Column("section", sa.String(255), nullable=True),
    )
    op.add_column(
        "questions",
        sa.Column(
            "is_ai_addendum",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    if v1_id is not None:
        bind.execute(
            sa.text(
                "UPDATE questions q "
                "SET section = s.title, is_ai_addendum = s.is_ai_addendum "
                "FROM questionnaire_sections s "
                "WHERE q.section_id = s.id AND q.version_id = :vid"
            ),
            {"vid": v1_id},
        )
        # Draft questions (not v1.0) must go — they have no String section to map
        bind.execute(
            sa.text("DELETE FROM questions WHERE version_id <> :vid"),
            {"vid": v1_id},
        )

    # Drop composite unique + FKs + indexes + new columns
    op.drop_constraint(
        "uq_questions_version_id_question_number", "questions", type_="unique"
    )
    op.drop_constraint("fk_questions_section_id", "questions", type_="foreignkey")
    op.drop_constraint("fk_questions_version_id", "questions", type_="foreignkey")
    op.drop_index("ix_questions_section_id", table_name="questions")
    op.drop_index("ix_questions_version_id", table_name="questions")

    op.drop_column("questions", "hint_text")
    op.drop_column("questions", "allows_other")
    op.drop_column("questions", "question_key")
    op.drop_column("questions", "section_id")
    op.drop_column("questions", "version_id")

    op.alter_column("questions", "section", nullable=False)
    op.create_unique_constraint(
        "questions_question_number_key", "questions", ["question_number"]
    )

    # 4. question_options
    op.drop_index("ix_question_options_question_id", table_name="question_options")
    op.drop_table("question_options")

    # 2. questionnaire_sections
    op.drop_index(
        "ix_questionnaire_sections_version_id",
        table_name="questionnaire_sections",
    )
    op.drop_table("questionnaire_sections")

    # 1. questionnaire_versions + partial indexes
    op.execute("DROP INDEX IF EXISTS only_one_current")
    op.execute("DROP INDEX IF EXISTS only_one_draft")
    op.drop_table("questionnaire_versions")
