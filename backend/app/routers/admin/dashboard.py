import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models.engagement import Engagement, EngagementStatus
from app.models.risk_assessment import StructuredFields
from app.services.auth import get_admin_user

router = APIRouter(tags=["admin-dashboard"])


_REV_SUFFIX_RE = re.compile(r"-R\d+$")


def _root_doc_number(doc_number: str) -> str:
    """Return the doc number with any trailing -R{n} suffix removed."""
    return _REV_SUFFIX_RE.sub("", doc_number or "")


def _root_doc_sort_key(doc_number: str) -> tuple[int, str]:
    """Parse the integer suffix of a root doc number for numeric ordering.

    Falls back to a lexical sort key when the doc number cannot be parsed
    (e.g. an admin manually edited the doc number to a non-numeric format).
    """
    root = _root_doc_number(doc_number)
    prefix = settings.doc_number_prefix
    if root.startswith(prefix):
        suffix = root[len(prefix):]
        try:
            return (0, str(int(suffix)).zfill(10))
        except ValueError:
            pass
    return (1, root)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class InventoryStructuredFields(BaseModel):
    service_type: Optional[str] = None
    hosting_location: Optional[str] = None
    hyperscaler: Optional[str] = None
    disaster_recovery: Optional[str] = None
    dr_location: Optional[str] = None
    data_residency_region: Optional[str] = None
    encryption_at_rest: Optional[str] = None
    encryption_in_transit: Optional[str] = None
    mfa_supported: Optional[str] = None


class InventoryItem(BaseModel):
    engagement_id: uuid.UUID
    doc_number_root: str
    application_name: str
    operating_companies: list[str]
    status: EngagementStatus
    is_ai_application: bool
    revision_label: str
    structured_fields: InventoryStructuredFields


class InventoryResponse(BaseModel):
    items: list[InventoryItem]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get("/dashboard/inventory", response_model=InventoryResponse)
async def get_inventory(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    admin: str = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> InventoryResponse:
    """One row per engagement family. The picked revision is the latest
    non-cancelled revision when one exists, otherwise the highest-revision
    row in the family regardless of status (so fully-cancelled families
    appear, represented by their latest cancelled revision). Sorted by
    root doc number descending.
    """
    all_rows = (
        await db.execute(
            select(Engagement).options(selectinload(Engagement.operating_companies))
        )
    ).scalars().all()

    by_id: dict[uuid.UUID, Engagement] = {e.id: e for e in all_rows}

    def root_id_for(e: Engagement) -> uuid.UUID:
        cur = e
        seen: set[uuid.UUID] = set()
        while cur.parent_engagement_id is not None and cur.parent_engagement_id in by_id:
            if cur.id in seen:
                break
            seen.add(cur.id)
            cur = by_id[cur.parent_engagement_id]
        return cur.id

    families: dict[uuid.UUID, list[Engagement]] = {}
    for e in all_rows:
        families.setdefault(root_id_for(e), []).append(e)

    sf_rows = (await db.execute(select(StructuredFields))).scalars().all()
    sf_by_engagement: dict[uuid.UUID, StructuredFields] = {
        sf.engagement_id: sf for sf in sf_rows
    }

    rows: list[tuple[tuple[int, str], InventoryItem]] = []
    for members in families.values():
        non_cancelled = [
            m for m in members if m.status != EngagementStatus.CANCELLED
        ]
        if non_cancelled:
            latest = max(non_cancelled, key=lambda m: m.revision_number)
        else:
            latest = max(members, key=lambda m: m.revision_number)
        root = next(
            (m for m in members if m.parent_engagement_id is None), members[0]
        )
        oc_names = sorted(
            (oc.name for oc in (latest.operating_companies or [])),
            key=lambda n: n.lower(),
        )

        sf = sf_by_engagement.get(latest.id)
        sf_payload = InventoryStructuredFields(
            service_type=sf.service_type if sf else None,
            hosting_location=sf.hosting_location if sf else None,
            hyperscaler=sf.hyperscaler if sf else None,
            disaster_recovery=sf.disaster_recovery if sf else None,
            dr_location=sf.dr_location if sf else None,
            data_residency_region=sf.data_residency_region if sf else None,
            encryption_at_rest=sf.encryption_at_rest if sf else None,
            encryption_in_transit=sf.encryption_in_transit if sf else None,
            mfa_supported=sf.mfa_supported if sf else None,
        )

        item = InventoryItem(
            engagement_id=latest.id,
            doc_number_root=_root_doc_number(root.doc_number),
            application_name=latest.application_name,
            operating_companies=oc_names,
            status=latest.status,
            is_ai_application=latest.is_ai_application,
            revision_label=f"R{latest.revision_number}",
            structured_fields=sf_payload,
        )
        rows.append((_root_doc_sort_key(root.doc_number), item))

    # Descending by parsed root doc number.
    rows.sort(key=lambda r: r[0], reverse=True)

    total = len(rows)
    start = (page - 1) * page_size
    end = start + page_size
    page_items = [item for _, item in rows[start:end]]

    return InventoryResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
    )
