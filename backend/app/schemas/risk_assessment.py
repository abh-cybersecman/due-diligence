import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.models.risk_assessment import RiskAssessmentStatus, RiskRating


class RiskItemCreate(BaseModel):
    description: str
    rating: RiskRating
    assigned_to: list[str] = []
    mitigation: str = ""
    order: int = 0


class RiskItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    description: str
    rating: RiskRating
    assigned_to: list[str]
    mitigation: str
    order: int


class RiskAssessmentCreate(BaseModel):
    overall_rating: Optional[RiskRating] = None
    summary: Optional[str] = None


class RiskAssessmentUpdate(BaseModel):
    overall_rating: Optional[RiskRating] = None
    summary: Optional[str] = None
    risk_items: Optional[list[RiskItemCreate]] = None


class RiskAssessmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    engagement_id: uuid.UUID
    overall_rating: Optional[RiskRating] = None
    summary: Optional[str] = None
    status: RiskAssessmentStatus
    risk_items: list[RiskItemResponse]
    created_at: datetime
    updated_at: datetime
