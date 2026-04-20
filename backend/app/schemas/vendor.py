from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict


class VendorAuthRequest(BaseModel):
    email: str
    token: str  # engagement vendor_token (UUID string)


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    question_number: int
    section: str
    question_text: str
    response_type: str
    is_ai_addendum: bool
    is_required: bool
    order: int


class ResponseSave(BaseModel):
    question_id: uuid.UUID
    response_text: Optional[str] = None
    selected_options: Optional[List[str]] = None


class ResponseBatch(BaseModel):
    responses: List[ResponseSave]


class ResponseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    question_id: uuid.UUID
    response_text: Optional[str] = None
    selected_options: Optional[List[str]] = None
    updated_at: datetime


class VendorFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    question_id: Optional[uuid.UUID] = None
    original_filename: str
    file_size_bytes: int
    mime_type: str
    uploaded_at: datetime


class EngagementFormOut(BaseModel):
    id: uuid.UUID
    application_name: str
    status: str
    is_ai_application: bool
    questions: List[QuestionOut]
    files: List[VendorFileOut]


class SubmitOut(BaseModel):
    status: str
    submitted_at: datetime
