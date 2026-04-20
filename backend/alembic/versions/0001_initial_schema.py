"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Named enum objects — reused across tables so SQLAlchemy creates them once
engagementstatus = sa.Enum(
    "DRAFT", "FUNCTIONAL_EVALUATION_PENDING", "DD_SENT_UNOPENED", "DD_IN_PROGRESS",
    "RISK_ASSESSMENT_PENDING", "CLOSED", "CLOSED_PENDING_IR_DOCS", "UNDER_REVIEW",
    name="engagementstatus",
)
responsetype = sa.Enum("TEXT", "SINGLE_CHOICE", "MULTI_CHOICE", "FILE_UPLOAD", name="responsetype")
filetype = sa.Enum("VENDOR_ATTACHMENT", "IR_FUNCTIONAL_EVALUATION", "IR_NDA", "IR_SOW", name="filetype")
riskrating = sa.Enum("CRITICAL", "HIGH", "MEDIUM", "LOW", name="riskrating")
riskassessmentstatus = sa.Enum("DRAFT", "FINALISED", name="riskassessmentstatus")
actortype = sa.Enum("ADMIN", "VENDOR", "IR", name="actortype")


def upgrade() -> None:
    # operating_companies
    op.create_table(
        "operating_companies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), unique=True, nullable=False),
    )

    # assignees
    op.create_table(
        "assignees",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("type_label", sa.String(100), nullable=True),
    )

    # engagements — engagementstatus enum created here automatically
    op.create_table(
        "engagements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("doc_number", sa.String(50), unique=True, nullable=False),
        sa.Column("application_name", sa.String(255), nullable=False),
        sa.Column("vendor_emails", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("ir_emails", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("is_ai_application", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("internal_notes", sa.Text(), nullable=True),
        sa.Column("status", engagementstatus, nullable=False, server_default="DRAFT"),
        sa.Column("vendor_token", postgresql.UUID(as_uuid=True), unique=True, nullable=False),
        sa.Column("ir_token", postgresql.UUID(as_uuid=True), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # engagement_oc association
    op.create_table(
        "engagement_oc",
        sa.Column("engagement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagements.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("oc_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("operating_companies.id", ondelete="CASCADE"), primary_key=True),
    )

    # questions — responsetype enum created here automatically
    op.create_table(
        "questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("question_number", sa.Integer(), unique=True, nullable=False),
        sa.Column("section", sa.String(255), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("response_type", responsetype, nullable=False, server_default="TEXT"),
        sa.Column("is_ai_addendum", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("order", sa.Integer(), nullable=False),
    )

    # responses
    op.create_table(
        "responses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("engagement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=True),
        sa.Column("selected_options", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    # file_uploads — filetype enum created here automatically
    op.create_table(
        "file_uploads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("engagement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("questions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("file_type", filetype, nullable=False),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column("stored_filename", sa.String(500), nullable=False),
        sa.Column("stored_path", sa.String(1000), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("uploaded_by", sa.String(255), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    )

    # risk_assessments — riskrating + riskassessmentstatus enums created here
    op.create_table(
        "risk_assessments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("engagement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagements.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("overall_rating", riskrating, nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("status", riskassessmentstatus, nullable=False, server_default="DRAFT"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    # risk_items — riskrating reused (already created above, create_type=False)
    op.create_table(
        "risk_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("risk_assessment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("risk_assessments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("rating", sa.Enum("CRITICAL", "HIGH", "MEDIUM", "LOW", name="riskrating", create_type=False), nullable=False),
        sa.Column("assigned_to", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("mitigation", sa.Text(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
    )

    # structured_fields
    op.create_table(
        "structured_fields",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("engagement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagements.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("application_name", sa.String(255), nullable=True),
        sa.Column("service_type", sa.String(255), nullable=True),
        sa.Column("hosting_location", sa.String(255), nullable=True),
        sa.Column("hyperscaler", sa.String(255), nullable=True),
        sa.Column("disaster_recovery", sa.String(255), nullable=True),
        sa.Column("dr_location", sa.String(255), nullable=True),
        sa.Column("data_residency_region", sa.String(255), nullable=True),
        sa.Column("encryption_at_rest", sa.String(255), nullable=True),
        sa.Column("encryption_in_transit", sa.String(255), nullable=True),
        sa.Column("mfa_supported", sa.String(255), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    # audit_logs — actortype enum created here automatically
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("engagement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("engagements.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor", sa.String(255), nullable=False),
        sa.Column("actor_type", actortype, nullable=False),
        sa.Column("action", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    # Indexes
    op.create_index("ix_engagements_status", "engagements", ["status"])
    op.create_index("ix_engagements_vendor_token", "engagements", ["vendor_token"])
    op.create_index("ix_engagements_ir_token", "engagements", ["ir_token"])
    op.create_index("ix_responses_engagement_id", "responses", ["engagement_id"])
    op.create_index("ix_file_uploads_engagement_id", "file_uploads", ["engagement_id"])
    op.create_index("ix_audit_logs_engagement_id", "audit_logs", ["engagement_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_index("ix_audit_logs_engagement_id", table_name="audit_logs")
    op.drop_index("ix_file_uploads_engagement_id", table_name="file_uploads")
    op.drop_index("ix_responses_engagement_id", table_name="responses")
    op.drop_index("ix_engagements_ir_token", table_name="engagements")
    op.drop_index("ix_engagements_vendor_token", table_name="engagements")
    op.drop_index("ix_engagements_status", table_name="engagements")

    op.drop_table("audit_logs")
    op.drop_table("structured_fields")
    op.drop_table("risk_items")
    op.drop_table("risk_assessments")
    op.drop_table("file_uploads")
    op.drop_table("responses")
    op.drop_table("questions")
    op.drop_table("engagement_oc")
    op.drop_table("engagements")
    op.drop_table("assignees")
    op.drop_table("operating_companies")

    actortype.drop(op.get_bind(), checkfirst=True)
    riskassessmentstatus.drop(op.get_bind(), checkfirst=True)
    riskrating.drop(op.get_bind(), checkfirst=True)
    filetype.drop(op.get_bind(), checkfirst=True)
    responsetype.drop(op.get_bind(), checkfirst=True)
    engagementstatus.drop(op.get_bind(), checkfirst=True)
