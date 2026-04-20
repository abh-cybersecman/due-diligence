import uuid
import enum
from sqlalchemy import String, Text, Boolean, Integer, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ResponseType(str, enum.Enum):
    TEXT = "TEXT"
    SINGLE_CHOICE = "SINGLE_CHOICE"
    MULTI_CHOICE = "MULTI_CHOICE"
    FILE_UPLOAD = "FILE_UPLOAD"


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    question_number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    section: Mapped[str] = mapped_column(String(255), nullable=False)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    response_type: Mapped[ResponseType] = mapped_column(
        SAEnum(ResponseType, name="responsetype"),
        default=ResponseType.TEXT,
        nullable=False,
    )
    is_ai_addendum: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)

    responses: Mapped[list["Response"]] = relationship("Response", back_populates="question")
    files: Mapped[list["FileUpload"]] = relationship("FileUpload", back_populates="question")
