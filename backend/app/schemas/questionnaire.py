"""Pydantic schemas for questionnaire versioning.

Introduced in Phase Q1 for the new QuestionnaireVersion / QuestionnaireSection /
QuestionOption tables and the reshaped Question. Phase Q2 wired reads; Phase Q3
adds the write-side request and response shapes for the admin editor.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.question import ResponseType


class QuestionOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    order: int


class QuestionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version_id: uuid.UUID
    section_id: uuid.UUID
    question_number: int
    question_key: str
    question_text: str
    response_type: ResponseType
    allows_other: bool
    hint_text: Optional[str] = None
    is_required: bool
    order: int
    options: list[QuestionOptionOut] = []


class QuestionnaireSectionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version_id: uuid.UUID
    title: str
    order: int
    is_ai_addendum: bool
    questions: list[QuestionSchema] = []


class QuestionnaireVersionSummary(BaseModel):
    """Version metadata only — no sections/questions payload."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version_label: str
    is_current: bool
    is_draft: bool
    published_at: Optional[datetime] = None
    changelog: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class QuestionnaireVersionDetail(QuestionnaireVersionSummary):
    """Full version payload including sections with their questions/options."""

    sections: list[QuestionnaireSectionSchema] = []


# ---------------------------------------------------------------------------
# Phase Q3 — write request bodies
# ---------------------------------------------------------------------------


class SectionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    is_ai_addendum: bool = False
    order: Optional[int] = None


class SectionUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    is_ai_addendum: Optional[bool] = None
    order: Optional[int] = None


class OptionInput(BaseModel):
    """Draft-editor option input.

    `id` is present for pre-existing options (preserved on PATCH) and absent
    for newly added ones. Order is taken from the array position; the explicit
    `order` field is optional and ignored if position differs.
    """

    id: Optional[uuid.UUID] = None
    label: str = Field(min_length=1, max_length=500)


class QuestionCreate(BaseModel):
    section_id: uuid.UUID
    question_text: str = Field(min_length=1)
    response_type: ResponseType
    is_required: bool = True
    hint_text: Optional[str] = None
    allows_other: bool = False
    options: list[OptionInput] = []


class QuestionUpdate(BaseModel):
    section_id: Optional[uuid.UUID] = None
    question_text: Optional[str] = Field(default=None, min_length=1)
    response_type: Optional[ResponseType] = None
    is_required: Optional[bool] = None
    hint_text: Optional[str] = None
    allows_other: Optional[bool] = None
    options: Optional[list[OptionInput]] = None


class OrderItem(BaseModel):
    id: uuid.UUID
    order: int


class ReorderBody(BaseModel):
    section_orders: Optional[list[OrderItem]] = None
    question_orders: Optional[dict[uuid.UUID, list[OrderItem]]] = None


# ---------------------------------------------------------------------------
# Phase Q3 — write responses
# ---------------------------------------------------------------------------


class SectionDeleteResponse(BaseModel):
    deleted_questions: int


class QuestionWriteResponse(BaseModel):
    """Returned on question create/update.

    `warnings` surfaces server-side side effects the UI should react to —
    currently the response_type change that forces a new `question_key`.
    """

    question: QuestionSchema
    warnings: list[str] = []
