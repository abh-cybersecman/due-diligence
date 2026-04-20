import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict


class OCCreate(BaseModel):
    name: str


class OCUpdate(BaseModel):
    name: str


class OCResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class AssigneeCreate(BaseModel):
    name: str
    type_label: Optional[str] = None


class AssigneeUpdate(BaseModel):
    name: Optional[str] = None
    type_label: Optional[str] = None


class AssigneeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    type_label: Optional[str] = None
