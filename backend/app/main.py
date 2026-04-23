from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.admin.audit import router as admin_audit_router
from app.routers.admin.auth import router as admin_auth_router
from app.routers.admin.engagements import router as admin_engagements_router
from app.routers.admin.questionnaire import router as admin_questionnaire_router
from app.routers.admin.risk_assessment import router as admin_risk_assessment_router
from app.routers.admin.settings import router as admin_settings_router
from app.routers.admin.structured_fields import router as admin_structured_fields_router
from app.routers.evaluation.auth import router as evaluation_auth_router
from app.routers.evaluation.engagements import router as evaluation_engagements_router
from app.routers.vendor.auth import router as vendor_auth_router
from app.routers.vendor.engagements import router as vendor_engagements_router


# Questionnaire seeding lives in Alembic migration 0004; no runtime seed hook.
app = FastAPI(
    title="ISDD Portal API",
    version="1.0.0",
    root_path=settings.app_base_path,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(admin_auth_router, prefix="/api/admin")
app.include_router(admin_engagements_router, prefix="/api/admin")
app.include_router(admin_risk_assessment_router, prefix="/api/admin")
app.include_router(admin_structured_fields_router, prefix="/api/admin")
app.include_router(admin_settings_router, prefix="/api/admin")
app.include_router(admin_audit_router, prefix="/api/admin")
app.include_router(admin_questionnaire_router, prefix="/api/admin")
app.include_router(evaluation_auth_router)
app.include_router(evaluation_engagements_router)
app.include_router(vendor_auth_router, prefix="/api/vendor/auth")
app.include_router(vendor_engagements_router, prefix="/api/vendor/engagements")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
