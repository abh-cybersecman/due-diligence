from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import AsyncSessionLocal
from app.seed import seed_questions
from app.routers.admin.engagements import router as admin_engagements_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncSessionLocal() as db:
        await seed_questions(db)
    yield


app = FastAPI(
    title="ISDD Portal API",
    version="1.0.0",
    root_path=settings.app_base_path,
    lifespan=lifespan,
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


app.include_router(admin_engagements_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
