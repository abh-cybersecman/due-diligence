import uuid
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.engagement import EngagementOC


class OperatingCompany(Base):
    __tablename__ = "operating_companies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)

    engagements: Mapped[list["Engagement"]] = relationship(
        "Engagement",
        secondary=EngagementOC,
        back_populates="operating_companies",
    )


class Assignee(Base):
    __tablename__ = "assignees"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type_label: Mapped[str | None] = mapped_column(String(100), nullable=True)
