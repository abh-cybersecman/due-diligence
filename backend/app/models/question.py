import uuid
import enum
from sqlalchemy import String, Text, Boolean, Integer, Enum as SAEnum, ForeignKey, UniqueConstraint
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
    __table_args__ = (
        UniqueConstraint(
            "version_id",
            "question_number",
            name="uq_questions_version_id_question_number",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("questionnaire_versions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("questionnaire_sections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    question_number: Mapped[int] = mapped_column(Integer, nullable=False)
    question_key: Mapped[str] = mapped_column(String(100), nullable=False)
    previous_question_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    response_type: Mapped[ResponseType] = mapped_column(
        SAEnum(ResponseType, name="responsetype"),
        default=ResponseType.TEXT,
        nullable=False,
    )
    allows_other: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    hint_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)

    version: Mapped["QuestionnaireVersion"] = relationship(
        "QuestionnaireVersion",
        back_populates="questions",
    )
    section: Mapped["QuestionnaireSection"] = relationship(
        "QuestionnaireSection",
        back_populates="questions",
    )
    options: Mapped[list["QuestionOption"]] = relationship(
        "QuestionOption",
        back_populates="question",
        cascade="all, delete-orphan",
        order_by="QuestionOption.order",
    )
    responses: Mapped[list["Response"]] = relationship("Response", back_populates="question")
    files: Mapped[list["FileUpload"]] = relationship("FileUpload", back_populates="question")
