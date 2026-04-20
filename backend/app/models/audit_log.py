import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ActorType(str, enum.Enum):
    ADMIN = "ADMIN"
    VENDOR = "VENDOR"
    IR = "IR"


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("engagements.id", ondelete="SET NULL"), nullable=True)
    actor: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_type: Mapped[ActorType] = mapped_column(SAEnum(ActorType, name="actortype"), nullable=False)
    action: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    engagement: Mapped["Engagement | None"] = relationship("Engagement", back_populates="audit_logs")
