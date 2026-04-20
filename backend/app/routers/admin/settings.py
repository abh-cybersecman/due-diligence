import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.audit_log import ActorType
from app.models.settings import Assignee, OperatingCompany
from app.schemas.settings import (
    AssigneeCreate,
    AssigneeResponse,
    AssigneeUpdate,
    OCCreate,
    OCResponse,
    OCUpdate,
)
from app.services.audit import log_action
from app.services.auth import get_admin_user

router = APIRouter(prefix="/settings", tags=["admin-settings"])


# ---------------------------------------------------------------------------
# Operating Company list
# ---------------------------------------------------------------------------

@router.get("/oc-list", response_model=list[OCResponse])
async def list_ocs(
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[OCResponse]:
    result = await db.execute(select(OperatingCompany).order_by(OperatingCompany.name))
    return [OCResponse.model_validate(oc) for oc in result.scalars().all()]


@router.post("/oc-list", response_model=OCResponse, status_code=201)
async def create_oc(
    body: OCCreate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> OCResponse:
    existing = (
        await db.execute(select(OperatingCompany).where(OperatingCompany.name == body.name))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Operating company with that name already exists")

    oc = OperatingCompany(name=body.name)
    db.add(oc)
    await db.flush()

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="settings.oc.created",
        description=f"Operating company '{body.name}' created",
        metadata={"name": body.name},
    )

    return OCResponse.model_validate(oc)


@router.patch("/oc-list/{oc_id}", response_model=OCResponse)
async def update_oc(
    oc_id: uuid.UUID,
    body: OCUpdate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> OCResponse:
    oc = (
        await db.execute(select(OperatingCompany).where(OperatingCompany.id == oc_id))
    ).scalar_one_or_none()
    if oc is None:
        raise HTTPException(status_code=404, detail="Operating company not found")

    old_name = oc.name
    oc.name = body.name

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="settings.oc.updated",
        description=f"Operating company renamed from '{old_name}' to '{body.name}'",
        metadata={"old_name": old_name, "new_name": body.name},
    )

    return OCResponse.model_validate(oc)


@router.delete("/oc-list/{oc_id}", status_code=204)
async def delete_oc(
    oc_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    oc = (
        await db.execute(select(OperatingCompany).where(OperatingCompany.id == oc_id))
    ).scalar_one_or_none()
    if oc is None:
        raise HTTPException(status_code=404, detail="Operating company not found")

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="settings.oc.deleted",
        description=f"Operating company '{oc.name}' deleted",
        metadata={"name": oc.name},
    )

    await db.delete(oc)


# ---------------------------------------------------------------------------
# Assignees
# ---------------------------------------------------------------------------

@router.get("/assignees", response_model=list[AssigneeResponse])
async def list_assignees(
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[AssigneeResponse]:
    result = await db.execute(select(Assignee).order_by(Assignee.name))
    return [AssigneeResponse.model_validate(a) for a in result.scalars().all()]


@router.post("/assignees", response_model=AssigneeResponse, status_code=201)
async def create_assignee(
    body: AssigneeCreate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> AssigneeResponse:
    assignee = Assignee(name=body.name, type_label=body.type_label)
    db.add(assignee)
    await db.flush()

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="settings.assignee.created",
        description=f"Assignee '{body.name}' created",
        metadata={"name": body.name, "type_label": body.type_label},
    )

    return AssigneeResponse.model_validate(assignee)


@router.patch("/assignees/{assignee_id}", response_model=AssigneeResponse)
async def update_assignee(
    assignee_id: uuid.UUID,
    body: AssigneeUpdate,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> AssigneeResponse:
    assignee = (
        await db.execute(select(Assignee).where(Assignee.id == assignee_id))
    ).scalar_one_or_none()
    if assignee is None:
        raise HTTPException(status_code=404, detail="Assignee not found")

    changed: dict = {}
    if body.name is not None:
        changed["name"] = {"from": assignee.name, "to": body.name}
        assignee.name = body.name
    if body.type_label is not None:
        changed["type_label"] = {"from": assignee.type_label, "to": body.type_label}
        assignee.type_label = body.type_label

    if changed:
        await log_action(
            db,
            actor=admin,
            actor_type=ActorType.ADMIN,
            action="settings.assignee.updated",
            description=f"Assignee updated",
            metadata={"changed": changed},
        )

    return AssigneeResponse.model_validate(assignee)


@router.delete("/assignees/{assignee_id}", status_code=204)
async def delete_assignee(
    assignee_id: uuid.UUID,
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    assignee = (
        await db.execute(select(Assignee).where(Assignee.id == assignee_id))
    ).scalar_one_or_none()
    if assignee is None:
        raise HTTPException(status_code=404, detail="Assignee not found")

    await log_action(
        db,
        actor=admin,
        actor_type=ActorType.ADMIN,
        action="settings.assignee.deleted",
        description=f"Assignee '{assignee.name}' deleted",
        metadata={"name": assignee.name},
    )

    await db.delete(assignee)
