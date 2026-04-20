import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class FileType(str, enum.Enum):
    VENDOR_ATTACHMENT = "VENDOR_ATTACHMENT"
    IR_FUNCTIONAL_EVALUATION = "IR_FUNCTIONAL_EVALUATION"
    IR_NDA = "IR_NDA"
    IR_SOW = "IR_SOW"


class FileUpload(Base):
    __tablename__ = "file_uploads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engagement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("engagements.id", ondelete="CASCADE"), nullable=False)
    question_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("questions.id", ondelete="SET NULL"), nullable=True)
    file_type: Mapped[FileType] = mapped_column(SAEnum(FileType, name="filetype"), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[str] = mapped_column(String(255), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    engagement: Mapped["Engagement"] = relationship("Engagement", back_populates="files")
    question: Mapped["Question | None"] = relationship("Question", back_populates="files")
