import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.models.engagement import EngagementStatus
from app.models.file_upload import FileType
from app.schemas.questionnaire import QuestionnaireSectionSchema
from app.schemas.settings import OCResponse


class StructuredFieldsUpdate(BaseModel):
    application_name: Optional[str] = None
    service_type: Optional[str] = None
    hosting_location: Optional[str] = None
    hyperscaler: Optional[str] = None
    disaster_recovery: Optional[str] = None
    dr_location: Optional[str] = None
    data_residency_region: Optional[str] = None
    encryption_at_rest: Optional[str] = None
    encryption_in_transit: Optional[str] = None
    mfa_supported: Optional[str] = None


class StructuredFieldsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    engagement_id: uuid.UUID
    application_name: Optional[str] = None
    service_type: Optional[str] = None
    hosting_location: Optional[str] = None
    hyperscaler: Optional[str] = None
    disaster_recovery: Optional[str] = None
    dr_location: Optional[str] = None
    data_residency_region: Optional[str] = None
    encryption_at_rest: Optional[str] = None
    encryption_in_transit: Optional[str] = None
    mfa_supported: Optional[str] = None
    updated_at: datetime


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
    # Family-aware fields (populated when files come from a multi-revision family)
    engagement_id: Optional[uuid.UUID] = None
    revision_number: Optional[int] = None


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
    other_text: str | None = None
    updated_at: datetime


class ResponseEntry(BaseModel):
    """Stored response for a question, in the version-aware payload."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    question_id: uuid.UUID
    response_text: Optional[str] = None
    selected_options: Optional[list[str]] = None
    other_text: Optional[str] = None
    updated_at: datetime


class VendorAttachmentEntry(BaseModel):
    """Vendor-uploaded file attached to a FILE_UPLOAD-type question."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    question_id: uuid.UUID
    original_filename: str
    file_size_bytes: int
    uploaded_at: datetime


class EngagementResponsesPayload(BaseModel):
    """Version-aware responses payload returned by IR and admin response endpoints.

    Includes the engagement's pinned questionnaire version (sections + questions
    + options) plus the saved response rows. Frontends render the structure from
    `sections` and look up answers in `responses` by question_id. For
    FILE_UPLOAD questions, vendor uploads are exposed via `vendor_attachments`
    keyed by `question_id`.
    """

    engagement_id: uuid.UUID
    questionnaire_version_id: uuid.UUID
    version_label: str
    is_ai_application: bool
    sections: list[QuestionnaireSectionSchema]
    responses: list[ResponseEntry]
    vendor_attachments: list[VendorAttachmentEntry] = []


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
    closed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    questionnaire_version_id: Optional[uuid.UUID] = None
    parent_engagement_id: Optional[uuid.UUID] = None
    revision_number: int = 0
    # Computed fields populated only on detail responses (None elsewhere).
    is_latest_revision: Optional[bool] = None
    latest_revision_id: Optional[uuid.UUID] = None
    latest_revision_doc_number: Optional[str] = None
    root_doc_number: Optional[str] = None
    parent_doc_number: Optional[str] = None
    revision_count: Optional[int] = None
    # Sibling revisions in the family — populated only when group_by_family is on.
    revisions: Optional[list["RevisionSibling"]] = None


class RevisionSibling(BaseModel):
    """Compact summary of one revision in a family — for grouped dashboard."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    doc_number: str
    status: EngagementStatus
    created_at: datetime
    submitted_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    revision_number: int


EngagementResponse.model_rebuild()


class EngagementListResponse(BaseModel):
    items: list[EngagementResponse]
    total: int


class RefreshEngagementRequest(BaseModel):
    password: str
