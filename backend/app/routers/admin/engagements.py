from fastapi import APIRouter, Depends

from app.services.auth import get_admin_user
from app.services.extraction import extract_structured_fields
from app.services.risk_ai import generate_risk_assessment

router = APIRouter(prefix="/api/admin/engagements", tags=["admin-engagements"])


@router.post("/{engagement_id}/extract")
async def extract_fields(
    engagement_id: str,
    _admin: str = Depends(get_admin_user),
):
    return await extract_structured_fields(engagement_id)


@router.post("/{engagement_id}/assess-risk")
async def assess_risk(
    engagement_id: str,
    _admin: str = Depends(get_admin_user),
):
    return await generate_risk_assessment(engagement_id)
