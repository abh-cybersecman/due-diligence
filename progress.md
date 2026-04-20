# ISDD Portal — Build Progress

## Phase 1 — Foundation ✅ `phase1-foundation`

- **Docker Compose** — three services (db, backend, frontend) with named volumes, postgres healthcheck, backend waits for DB healthy before starting
- **FastAPI skeleton** — app mounted at `/due-diligence` base path, CORS configured to frontend origin, `lifespan` event runs question seeding on startup
- **SQLAlchemy ORM models** — all models implemented with UUID PKs, async session, UTC timestamps:
  - `Engagement` — status enum, vendor/IR tokens, ARRAY email fields, OC many-to-many
  - `Question` — response type enum, AI addendum flag, ordering
  - `Response` — per-engagement/per-question, text + selected options
  - `FileUpload` — file type enum, stored filename (UUID-based), mime type, size, uploader
  - `RiskAssessment` + `RiskItem` — overall rating, summary, line items with ARRAY assignees
  - `StructuredFields` — all 10 extracted fields, one per engagement
  - `AuditLog` — actor, actor type enum, action key, description, JSONB metadata
  - `OperatingCompany` + `Assignee` — settings tables
- **Alembic** — `env.py` reads `DATABASE_URL` from environment; single `0001_initial_schema` migration creates all 12 tables, 6 enum types, and 7 indexes; runs automatically on backend startup via `entrypoint.sh`
- **Question seeding** — all 43 questions loaded from `seed/questions.json` on first startup:
  - Q1–30: standard due diligence questionnaire across 7 sections
  - Q31–43: AI addendum (`is_ai_addendum=true`) across 3 sub-sections
  - Q9, Q10: `FILE_UPLOAD` type (architecture and network diagrams)
- **Stub services** — `extraction.py`, `risk_ai.py`, `notifications.py` with correct return shapes, ready for Phase 3 wiring
- **Utilities** — `sanitize.py` (bleach-based XSS stripping), `tokens.py` (UUID generation)
- **`.env.example`** — all required keys documented; `.gitignore` covering `.env`, `__pycache__`, `node_modules`, build output
- **Frontend scaffold** — minimal Vite + React app, multi-stage Docker build, nginx serving static files with API proxy

## Phase 2 — Not started

## Phase 3 — Not started

## Phase 4 — Not started
