"""Pydantic schemas for questionnaire versioning.

Introduced in Phase Q1 for the new QuestionnaireVersion / QuestionnaireSection /
QuestionOption tables and the reshaped Question. Phase Q2 wires these into the
admin editor endpoints; Q1 only defines the shapes.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

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
