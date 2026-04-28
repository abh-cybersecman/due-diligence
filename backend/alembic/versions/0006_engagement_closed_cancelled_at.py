"""Add closed_at and cancelled_at to engagements.

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-28

Status badges in the Responses and Export revision pickers were proxying
"submitted_at" as a state indicator, which mis-labels engagements that were
admin-closed without a vendor submission ("R2 (current) — not submitted"
when status is CLOSED). The fix is to label by status and surface a precise
timestamp for the terminal states.

Backfill walks the audit log for the most recent transition into CLOSED /
CANCELLED per engagement; engagements that never entered those states keep
NULL values.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "engagements",
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "engagements",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Backfill: latest audit_log row per engagement where metadata.to == X.
    # Status transitions go through one of:
    #   action='engagement.cancelled' (CANCELLED)
    #   action='engagement.status.changed' (any, incl. CLOSED via /close, /set-status)
    # For CLOSED specifically, we look for any audit row whose metadata->>'to'
    # equals 'CLOSED' — that covers /close-from-pending, /close, and
    # /set-status paths which all log the same shape.
    op.execute(
        """
        UPDATE engagements e SET closed_at = sub.created_at
        FROM (
            SELECT DISTINCT ON (al.engagement_id)
                al.engagement_id, al.created_at
            FROM audit_logs al
            WHERE al.metadata->>'to' = 'CLOSED'
            ORDER BY al.engagement_id, al.created_at DESC
        ) sub
        WHERE sub.engagement_id = e.id
        """
    )
    op.execute(
        """
        UPDATE engagements e SET cancelled_at = sub.created_at
        FROM (
            SELECT DISTINCT ON (al.engagement_id)
                al.engagement_id, al.created_at
            FROM audit_logs al
            WHERE al.metadata->>'to' = 'CANCELLED'
            ORDER BY al.engagement_id, al.created_at DESC
        ) sub
        WHERE sub.engagement_id = e.id
        """
    )


def downgrade() -> None:
    op.drop_column("engagements", "cancelled_at")
    op.drop_column("engagements", "closed_at")
