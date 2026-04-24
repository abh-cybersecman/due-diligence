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
# Batched save input (admin editor's single source of truth)
# ---------------------------------------------------------------------------


class SaveOptionInput(BaseModel):
    """Option payload in the batched save body.

    `id` is present for pre-existing options (matched in place), absent for
    newly added ones. Order is taken from array position.
    """

    id: Optional[uuid.UUID] = None
    label: str = Field(min_length=1, max_length=500)


class SaveQuestionInput(BaseModel):
    id: Optional[uuid.UUID] = None
    question_text: str = Field(min_length=1)
    response_type: ResponseType
    is_required: bool = True
    hint_text: Optional[str] = None
    allows_other: bool = False
    options: list[SaveOptionInput] = []


class SaveSectionInput(BaseModel):
    id: Optional[uuid.UUID] = None
    title: str = Field(min_length=1, max_length=255)
    is_ai_addendum: bool = False
    questions: list[SaveQuestionInput] = []


class SaveDraftBody(BaseModel):
    sections: list[SaveSectionInput]


class SaveDraftSummary(BaseModel):
    sections_created: int = 0
    sections_edited: int = 0
    sections_deleted: int = 0
    questions_created: int = 0
    questions_edited: int = 0
    questions_deleted: int = 0
    options_created: int = 0
    options_edited: int = 0
    options_deleted: int = 0
    question_keys_minted: int = 0


class SaveDraftResponse(BaseModel):
    """Canonical draft state after save, plus a change summary and warnings."""

    draft: QuestionnaireVersionDetail
    summary: SaveDraftSummary
    warnings: list[str] = []


# ---------------------------------------------------------------------------
# Diff (Phase Q4)
# ---------------------------------------------------------------------------


class DiffSectionAdded(BaseModel):
    title: str
    is_ai_addendum: bool


class DiffSectionRemoved(BaseModel):
    title: str


class DiffSectionRenamed(BaseModel):
    before: str
    after: str


class DiffSections(BaseModel):
    added: list[DiffSectionAdded] = []
    removed: list[DiffSectionRemoved] = []
    renamed: list[DiffSectionRenamed] = []


class DiffQuestionAdded(BaseModel):
    question_key: str
    question_text: str
    section_title: str
    response_type: ResponseType
    is_required: bool


class DiffQuestionRemoved(BaseModel):
    question_key: str
    question_text: str
    section_title: str


class DiffQuestionSnapshot(BaseModel):
    text: str
    response_type: ResponseType
    is_required: bool
    allows_other: bool
    hint_text: Optional[str] = None
    options: list[str] = []


class DiffQuestionEdited(BaseModel):
    question_key: str
    section_title: str
    before: DiffQuestionSnapshot
    after: DiffQuestionSnapshot


class DiffQuestions(BaseModel):
    added: list[DiffQuestionAdded] = []
    removed: list[DiffQuestionRemoved] = []
    edited: list[DiffQuestionEdited] = []
    unchanged_count: int = 0


class DraftDiff(BaseModel):
    from_version_label: Optional[str] = None
    to_version_label: str
    sections: DiffSections
    questions: DiffQuestions
    has_non_sequential_numbers: bool = False


# ---------------------------------------------------------------------------
# Publish / Discard (Phase Q4)
# ---------------------------------------------------------------------------


VERSION_LABEL_REGEX = r"^v\d+\.\d+$"


class PublishDraftBody(BaseModel):
    changelog: str
    password: str
    version_label: Optional[str] = Field(default=None, pattern=VERSION_LABEL_REGEX)


class PublishDraftResponse(BaseModel):
    new_version: QuestionnaireVersionDetail
    new_draft: QuestionnaireVersionDetail


class DiscardDraftResponse(BaseModel):
    draft: QuestionnaireVersionDetail
