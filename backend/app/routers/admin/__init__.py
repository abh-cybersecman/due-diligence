from fastapi import APIRouter

from .audit import router as audit_router
from .auth import router as auth_router
from .engagements import router as engagements_router
from .settings import router as settings_router

router = APIRouter(prefix="/api/admin")
router.include_router(auth_router)
router.include_router(engagements_router)
router.include_router(settings_router)
router.include_router(audit_router)
