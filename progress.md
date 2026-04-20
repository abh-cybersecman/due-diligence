# ISDD Portal — Build Progress

---

## Phase 1 — COMPLETE ✅

### Foundation `b5885a9`

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
- **Question seeding** — all 43 questions loaded from `seed/questions.json` on first startup (Q1–30 standard, Q31–43 AI addendum, Q9/Q10 FILE_UPLOAD)
- **Stub services** — `extraction.py`, `risk_ai.py`, `notifications.py` with correct return shapes, ready for Phase 3 wiring
- **Utilities** — `sanitize.py` (bleach-based XSS stripping, zero allowed tags/attributes), `tokens.py` (UUID generation)
- **Auth service** — `services/auth.py`: bcrypt password verify/hash, JWT creation for all three roles with correct scoping (`engagement_id` in vendor and IR payloads), `get_admin_user`, `get_vendor_user`, `get_ir_user` FastAPI dependencies
- **Frontend scaffold** — minimal Vite + React app, multi-stage Docker build, nginx serving static files with API proxy

### Admin auth + engagement CRUD + lifecycle `c8fad5a`

- **Admin auth** — `POST /api/admin/auth/login` (bcrypt verify, constant-time to prevent username enumeration, JWT issued, audit logged), `POST /api/admin/auth/logout` (audit logged); generic 401 on any failure — never reveals which credential was wrong
- **Engagement CRUD** — `GET /api/admin/engagements` (status filter, ilike search, paginated); `POST /api/admin/engagements` (doc number auto-generated as `ABHIT-IST-DD-XXXX` via numeric MAX+1, UUID4 vendor + IR tokens set at creation); `GET /api/admin/engagements/{id}`; `PATCH /api/admin/engagements/{id}` (all fields including doc_number, OC associations replaced atomically)
- **Lifecycle state machine** — `services/lifecycle.py` with `VALID_TRANSITIONS` dict covering all 8 statuses; `validate_transition()` raises HTTP 400 on any invalid move; `POST /{id}/advance` (DRAFT → FUNCTIONAL_EVALUATION_PENDING), `POST /{id}/reopen` (RISK_ASSESSMENT_PENDING → DD_IN_PROGRESS), `POST /{id}/set-status` (any valid manual transition)
- **Admin responses + file endpoints** — `GET /api/admin/engagements/{id}/responses` (full response list with question details); `GET /api/admin/engagements/{id}/files/{file_id}` (authenticated download via FileResponse, verifies file belongs to engagement)
- **Phase 3 stubs** — `POST /{id}/extract` and `POST /{id}/assess-risk` wired to stub services, guarded by admin JWT, return correct shape
- **OC list + assignees CRUD** — full CRUD at `/api/admin/settings/oc-list` and `/api/admin/settings/assignees`; duplicate OC name → 409; all mutations audit-logged
- **Audit log query endpoints** — `GET /api/admin/audit` (system-wide, paginated); `GET /api/admin/engagements/{id}/audit` (per-engagement, paginated)
- **Pydantic schemas** — `schemas/auth.py`, `schemas/engagement.py` (admin + IR), `schemas/settings.py`, `schemas/vendor.py`, `schemas/audit.py` (metadata_ → metadata alias for JSON output)
- **IR portal backend** — `POST /api/evaluation/auth/verify`: scoped JWT (type=ir, engagement_id), generic 401, failures audit-logged; `GET /{token}/status` (engagement info + uploaded IR docs); `GET /{token}/responses` (read-only); `POST /{token}/files`: magic-byte validation, Pillow verify() on images, UUID4 filename, count/total limits checked before disk write, lifecycle trigger FUNCTIONAL_EVALUATION_PENDING → DD_SENT_UNOPENED on functional eval upload; `DELETE /{token}/files/{id}` — JWT scope enforced on every request
- **Vendor portal backend** — `POST /api/vendor/auth/verify`: scoped JWT (type=vendor, engagement_id), generic 401; `GET /{token}` (metadata + questions + uploaded files); `GET /{token}/responses`; `POST /{token}/responses` (upsert autosave, DD_SENT_UNOPENED → DD_IN_PROGRESS on first save); `POST /{token}/files` (same security controls as IR); `DELETE /{token}/files/{id}`; `POST /{token}/submit` (→ RISK_ASSESSMENT_PENDING, sets submitted_at) — JWT scope (engagement_id) enforced on every single endpoint via `get_vendor_engagement()` dependency
- **File security** — python-magic byte validation before storage; Pillow `img.verify()` on images; UUID4 filename, no extension; written to Docker volumes outside web root; count + total-size limits checked against DB before touching disk; 0o755 directories
- **Input sanitization** — bleach applied to all vendor/IR text inputs at write time
- **Audit logging** — all auth events (success + failure), status transitions, file uploads/deletes, and submissions written with actor, actor_type, action key, description, JSONB metadata

### Frontend (IR + vendor portals) `8564d21`

- **Design system** — CSS custom properties for full light/dark palette (`styles/design-system.css`); Geist font; all tokens from CLAUDE.md (accent, risk, status, shadow, radius, text sizes); theme toggle persists to localStorage; OS `prefers-color-scheme` respected on first load
- **AuthContext** — IR/vendor sessions in sessionStorage, admin in localStorage; typed login/logout helpers for all three roles
- **EvaluationLogin.jsx** — centered email form; token from URL params; generic error message on failure
- **EvaluationPortal.jsx** — sticky header with status badge + dark mode toggle; drag-and-drop upload zones for Functional Evaluation, NDA, SOW; file list with size + delete; inline save confirmation; read-only once DD dispatched
- **VendorLogin.jsx** — auth gate at `/respond/:token`; shows email form if session absent or token mismatch
- **VendorQuestionnaire.jsx** — sticky header; questions grouped by section with Q-number + required indicator; AI addendum sections conditional on `is_ai_application`; 800ms debounced autosave; FILE_UPLOAD questions with drag-and-drop; read-only overlay when status outside `{DD_SENT_UNOPENED, DD_IN_PROGRESS}`; submit confirmation modal
- **App.jsx** — BrowserRouter with basename, routes for evaluation + vendor portals; theme initialised before first render to prevent flash

---

## Phase 2 — Not started

**Remaining work:**

### Admin dashboard + engagement detail (frontend)
- [ ] Admin login page (`pages/admin/Login.jsx`)
- [ ] Admin dashboard (`pages/admin/Dashboard.jsx`) — engagement table with all columns, status badges, filters (status, search), pagination
- [ ] New engagement form (`pages/admin/NewEngagement.jsx`) — application name, OC multi-select, vendor/IR emails, AI flag
- [ ] Engagement detail page (`pages/admin/EngagementDetail.jsx`) — responses panel, structured fields panel, risk assessment panel, file download, lifecycle action buttons

### Structured fields (backend + frontend)
- [ ] `GET /api/admin/engagements/{id}/structured-fields`
- [ ] `PATCH /api/admin/engagements/{id}/structured-fields`
- [ ] Frontend panel — all 10 fields editable; "Extract with AI" button present but disabled with tooltip

### Risk assessment (backend + frontend)
- [ ] `POST /api/admin/engagements/{id}/risk-assessment` — create draft
- [ ] `GET /api/admin/engagements/{id}/risk-assessment`
- [ ] `PATCH /api/admin/engagements/{id}/risk-assessment` — edit summary, rating, risk items
- [ ] `POST /api/admin/engagements/{id}/risk-assessment/finalise` — triggers RISK_ASSESSMENT_PENDING → CLOSED or CLOSED_PENDING_IR_DOCS depending on IR doc presence
- [ ] `POST /api/admin/engagements/{id}/risk-assessment/reopen`
- [ ] Frontend panel — create/edit risk items, multi-select assignee chips, overall rating, finalise/reopen; "Generate with AI" button disabled with tooltip
- [ ] Engagement can only be Closed with a finalised risk assessment

### CLOSED_PENDING_IR_DOCS auto-resolution (backend)
- [ ] When missing NDA or SOW uploaded by IR: auto-advance CLOSED_PENDING_IR_DOCS → CLOSED; audit logged

### Audit log UI (frontend)
- [ ] `pages/admin/Settings.jsx` — OC list + assignees management (CRUD already done backend); system-wide audit log table; per-engagement audit log shown in engagement detail

### Word export
- [ ] `services/export.py` — python-docx: cover page, document control, executive summary scaffold, risk assessment section, full questionnaire by section; AI addendum as labelled sub-section; Dax/Arial font, Albatha navy/blue palette, risk-colour-coded table rows
- [ ] `GET /api/admin/engagements/{id}/export` — streams `.docx` file

### Database backup (Phase 2 deferred)
- [ ] `services/backup.py` — pg_dump via subprocess, tar.gz with uploads, backup metadata JSON
- [ ] `POST /api/admin/settings/backup/trigger` — requires password re-confirmation, rate-limited 5/hr
- [ ] `GET /api/admin/settings/backup/status` + `GET /api/admin/settings/backup/download`

---

## Phase 3 — Not started

- [ ] Claude API integration for field extraction (`services/extraction.py`)
- [ ] Claude API integration for risk assessment generation (`services/risk_ai.py`)
- [ ] Email notification wiring — SMTP for vendor link, IR link, submission alert (`services/notifications.py`)

---

## Phase 4 — Not started

- [ ] JSON import with review-before-save flow
- [ ] AI-powered Word import via Claude API
