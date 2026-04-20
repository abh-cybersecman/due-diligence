import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RiskRating(str, enum.Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class RiskAssessmentStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    FINALISED = "FINALISED"


class RiskAssessment(Base):
    __tablename__ = "risk_assessments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("engagements.id", ondelete="CASCADE"), unique=True, nullable=False)
    overall_rating: Mapped[RiskRating | None] = mapped_column(SAEnum(RiskRating, name="riskrating"), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[RiskAssessmentStatus] = mapped_column(
        SAEnum(RiskAssessmentStatus, name="riskassessmentstatus"),
        default=RiskAssessmentStatus.DRAFT,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    engagement: Mapped["Engagement"] = relationship("Engagement", back_populates="risk_assessment")
    risk_items: Mapped[list["RiskItem"]] = relationship("RiskItem", back_populates="risk_assessment", cascade="all, delete-orphan", order_by="RiskItem.order")


class RiskItem(Base):
    __tablename__ = "risk_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    risk_assessment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("risk_assessments.id", ondelete="CASCADE"), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    rating: Mapped[RiskRating] = mapped_column(SAEnum(RiskRating, name="riskrating"), nullable=False)
    assigned_to: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    mitigation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    risk_assessment: Mapped["RiskAssessment"] = relationship("RiskAssessment", back_populates="risk_items")


class StructuredFields(Base):
    __tablename__ = "structured_fields"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("engagements.id", ondelete="CASCADE"), unique=True, nullable=False)
    application_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    service_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hosting_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hyperscaler: Mapped[str | None] = mapped_column(String(255), nullable=True)
    disaster_recovery: Mapped[str | None] = mapped_column(String(255), nullable=True)
    dr_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    data_residency_region: Mapped[str | None] = mapped_column(String(255), nullable=True)
    encryption_at_rest: Mapped[str | None] = mapped_column(String(255), nullable=True)
    encryption_in_transit: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mfa_supported: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    engagement: Mapped["Engagement"] = relationship("Engagement", back_populates="structured_fields")
