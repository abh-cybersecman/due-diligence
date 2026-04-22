import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Text, DateTime, Enum as SAEnum, ForeignKey, Table, Column
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.database import Base


class EngagementStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    FUNCTIONAL_EVALUATION_PENDING = "FUNCTIONAL_EVALUATION_PENDING"
    PENDING_DISPATCH = "PENDING_DISPATCH"
    DD_IN_PROGRESS = "DD_IN_PROGRESS"
    RISK_ASSESSMENT_PENDING = "RISK_ASSESSMENT_PENDING"
    CLOSED = "CLOSED"
    PENDING_CLOSURE = "PENDING_CLOSURE"
    UNDER_REVIEW = "UNDER_REVIEW"
    CANCELLED = "CANCELLED"


# Association table for engagement <-> operating company
EngagementOC = Table(
    "engagement_oc",
    Base.metadata,
    Column("engagement_id", UUID(as_uuid=True), ForeignKey("engagements.id", ondelete="CASCADE"), primary_key=True),
    Column("oc_id", UUID(as_uuid=True), ForeignKey("operating_companies.id", ondelete="CASCADE"), primary_key=True),
)


class Engagement(Base):
    __tablename__ = "engagements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    application_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor_emails: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    ir_emails: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    is_ai_application: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[EngagementStatus] = mapped_column(
        SAEnum(EngagementStatus, name="engagementstatus"),
        default=EngagementStatus.DRAFT,
        nullable=False,
    )
    vendor_token: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True, default=uuid.uuid4, nullable=False)
    ir_token: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True, default=uuid.uuid4, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    operating_companies: Mapped[list["OperatingCompany"]] = relationship(
        "OperatingCompany",
        secondary=EngagementOC,
        back_populates="engagements",
        lazy="selectin",
    )
    responses: Mapped[list["Response"]] = relationship("Response", back_populates="engagement", cascade="all, delete-orphan")
    files: Mapped[list["FileUpload"]] = relationship("FileUpload", back_populates="engagement", cascade="all, delete-orphan")
    risk_assessment: Mapped["RiskAssessment | None"] = relationship("RiskAssessment", back_populates="engagement", uselist=False, cascade="all, delete-orphan")
    structured_fields: Mapped["StructuredFields | None"] = relationship("StructuredFields", back_populates="engagement", uselist=False, cascade="all, delete-orphan")
    audit_logs: Mapped[list["AuditLog"]] = relationship("AuditLog", back_populates="engagement", cascade="all, delete-orphan")
