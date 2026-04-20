import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.models.engagement import EngagementStatus
from app.models.file_upload import FileType
from app.schemas.settings import OCResponse


# ---------------------------------------------------------------------------
# IR / evaluation portal schemas
# ---------------------------------------------------------------------------

class IRDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_type: FileType
    original_filename: str
    mime_type: str
    file_size_bytes: int
    uploaded_by: str
    uploaded_at: datetime


class EngagementStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    doc_number: str
    application_name: str
    status: EngagementStatus
    is_ai_application: bool
    created_at: datetime
    updated_at: datetime
    ir_documents: list[IRDocumentOut]


class ResponseDetail(BaseModel):
    id: uuid.UUID
    question_id: uuid.UUID
    question_number: int
    section: str
    question_text: str
    response_text: str | None
    selected_options: list[str] | None
    updated_at: datetime


# ---------------------------------------------------------------------------
# Admin portal schemas
# ---------------------------------------------------------------------------

class EngagementCreate(BaseModel):
    application_name: str
    operating_company_ids: list[uuid.UUID] = []
    vendor_emails: list[str]
    ir_emails: list[str]
    is_ai_application: bool = False
    internal_notes: Optional[str] = None


class EngagementUpdate(BaseModel):
    application_name: Optional[str] = None
    doc_number: Optional[str] = None
    operating_company_ids: Optional[list[uuid.UUID]] = None
    vendor_emails: Optional[list[str]] = None
    ir_emails: Optional[list[str]] = None
    is_ai_application: Optional[bool] = None
    internal_notes: Optional[str] = None


class SetStatusRequest(BaseModel):
    status: EngagementStatus


class EngagementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    doc_number: str
    application_name: str
    operating_companies: list[OCResponse]
    vendor_emails: list[str]
    ir_emails: list[str]
    is_ai_application: bool
    internal_notes: Optional[str] = None
    status: EngagementStatus
    vendor_token: uuid.UUID
    ir_token: uuid.UUID
    created_at: datetime
    updated_at: datetime
    submitted_at: Optional[datetime] = None


class EngagementListResponse(BaseModel):
    items: list[EngagementResponse]
    total: int
