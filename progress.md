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
- **Utilities** — `sanitize.py` (bleach-based XSS stripping, zero allowed tags/attributes), `tokens.py` (UUID generation)
- **Auth service** — `services/auth.py`: bcrypt password verify/hash, JWT creation for all three roles (admin/vendor/IR) with correct scoping (`engagement_id` in vendor and IR payloads), FastAPI `Depends`-compatible guards `get_admin_user`, `get_vendor_user`, `get_ir_user`
- **Stub API endpoints** — `POST /api/admin/engagements/{id}/extract` and `POST /api/admin/engagements/{id}/assess-risk` wired to stub services, guarded by `get_admin_user`; router package scaffolding (`routers/admin/`, `routers/evaluation/`, `routers/vendor/`) with `__init__.py` files
- **`.env.example`** — all required keys documented; `.gitignore` covering `.env`, `__pycache__`, `node_modules`, build output
- **Frontend scaffold** — minimal Vite + React app, multi-stage Docker build, nginx serving static files with API proxy

## Phase 1 — Admin auth + engagement CRUD ✅ `c8fad5a`

- **Admin auth** — `POST /api/admin/auth/login` (bcrypt verify, JWT issued), `POST /api/admin/auth/logout`; `get_admin_user` dependency guards all admin routes
- **Engagement CRUD** — `GET/POST /api/admin/engagements`, `GET/PATCH /api/admin/engagements/{id}`; doc number auto-generated (`ABHIT-IST-DD-XXXX` from `DOC_NUMBER_START`); vendor + IR tokens generated at creation
- **Engagement lifecycle state machine** — all transitions enforced server-side with 400 on invalid moves; advance, reopen, set-status endpoints implemented
- **OC list settings** — full CRUD at `/api/admin/settings/oc-list`
- **Pydantic schemas** — `schemas/auth.py`, `schemas/engagement.py`, `schemas/settings.py`, `schemas/vendor.py` for all request/response shapes
- **IR portal backend** — `POST /api/evaluation/auth/verify`: scoped JWT (type=ir, engagement_id), generic 401, audit logged; `GET /engagements/{token}/status`, `GET /engagements/{token}/responses` (read-only); `POST /engagements/{token}/files`: full security controls (magic-byte, Pillow, UUID filename, count/total limits before disk write), lifecycle trigger FUNCTIONAL_EVALUATION_PENDING → DD_SENT_UNOPENED on functional eval upload; `DELETE /engagements/{token}/files/{id}`
- **Vendor portal backend** — `POST /api/vendor/auth/verify`: scoped JWT (type=vendor, engagement_id), generic 401, audit logged; `GET /engagements/{token}` (metadata + questions + files), `GET /engagements/{token}/responses`, `POST /engagements/{token}/responses` (upsert autosave + DD_SENT_UNOPENED → DD_IN_PROGRESS on first save), `POST /engagements/{token}/files` (same security controls as IR), `DELETE /engagements/{token}/files/{id}`, `POST /engagements/{token}/submit` (→ RISK_ASSESSMENT_PENDING)
- **JWT scoping enforced on every request** — `get_vendor_engagement()` and `get_ir_engagement()` dependencies validate type and assert `engagement_id` in JWT matches the engagement resolved by the URL token on every single endpoint, not just auth
- **File security controls** — python-magic byte validation before storage; Pillow `img.verify()` on all images; UUID4 filename stored with no extension; files written to Docker volumes outside web root; count/total limits checked against DB before touching disk; 0o755 directory creation
- **Input sanitization** — bleach applied to all vendor/IR text inputs at write time via `sanitize_text()`
- **Audit logging** — all auth events (success and failure), status changes, file uploads/deletes, and submissions logged to `audit_logs` with actor, actor_type, action key, description, and JSONB metadata

## Phase 1 — Frontend ✅ `8564d21`

- **Design system** — CSS custom properties for full light/dark palette (`styles/design-system.css` + `index.css`); Geist font; all tokens from CLAUDE.md (accent, risk, status, shadow, radius, text sizes); theme toggle persists to localStorage; OS preference respected on first load
- **AuthContext** — IR, vendor, and admin session management; IR/vendor in sessionStorage, admin in localStorage; `loginVendor/logoutVendor`, `loginIR/logoutIR`, `loginAdmin/logoutAdmin`
- **EvaluationLogin.jsx** — centered email form; token from URL params; `POST /api/evaluation/auth/verify`; session stored on success
- **EvaluationPortal.jsx** — sticky header with status badge and dark mode toggle; drag-and-drop upload zones for Functional Evaluation, NDA, SOW; file list with size display and per-file delete; inline save confirmation; read-only once DD dispatched
- **VendorLogin.jsx** — auth gate at `/respond/:token`; shows email form if session absent or token mismatch; renders VendorQuestionnaire when authenticated
- **VendorQuestionnaire.jsx** — sticky header with app name, status badge, 800ms debounced save indicator, dark mode toggle; questions grouped by section with Q-number + required indicator; AI addendum sections shown only if `is_ai_application`; TEXT questions: textarea with debounced autosave (pending changes coalesced, flushed before submit); FILE_UPLOAD questions: drag-and-drop zone with file list; read-only overlay with notice when status outside `{DD_SENT_UNOPENED, DD_IN_PROGRESS}`; submit confirmation modal; attachments summary panel
- **App.jsx** — BrowserRouter with basename, routes for evaluation and vendor portals; theme initialised before first render

## Phase 2 — Not started

## Phase 3 — Not started

## Phase 4 — Not started
