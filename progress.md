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
- **IR portal backend** — `POST /api/evaluation/auth/verify`: scoped JWT (type=ir, engagement_id), generic 401, failures audit-logged; `GET /{token}/status` (engagement info + uploaded IR docs); `GET /{token}/responses` (read-only); `POST /{token}/files`: magic-byte validation, Pillow verify() on images, UUID4 filename, count/total limits checked before disk write, lifecycle trigger FUNCTIONAL_EVALUATION_PENDING → PENDING_DISPATCH on functional eval upload; `DELETE /{token}/files/{id}` — JWT scope enforced on every request
- **Vendor portal backend** — `POST /api/vendor/auth/verify`: scoped JWT (type=vendor, engagement_id), generic 401; `GET /{token}` (metadata + questions + uploaded files); `GET /{token}/responses`; `POST /{token}/responses` (upsert autosave, DD_SENT_UNOPENED → DD_IN_PROGRESS on first save); `POST /{token}/files` (same security controls as IR); `DELETE /{token}/files/{id}`; `POST /{token}/submit` (→ RISK_ASSESSMENT_PENDING, sets submitted_at) — JWT scope (engagement_id) enforced on every single endpoint via `get_vendor_engagement()` dependency
- **File security** — python-magic byte validation before storage; Pillow `img.verify()` on images; UUID4 filename, no extension; written to Docker volumes outside web root; count + total-size limits checked against DB before touching disk; 0o755 directories
- **Input sanitization** — bleach applied to all vendor/IR text inputs at write time
- **Audit logging** — all auth events (success + failure), status transitions, file uploads/deletes, and submissions written with actor, actor_type, action key, description, JSONB metadata

### Frontend (IR + vendor portals) `8564d21`

### Hotfix: passlib → bcrypt direct `6d50c8a`

- **Root cause** — `passlib 1.7.4` is incompatible with `bcrypt >= 4.0.0`; its internal wrap-bug detection test raises `ValueError` on any login attempt, returning 500 instead of 401
- **Fix** — removed passlib entirely; replaced with `bcrypt==4.2.1` used directly (`bcrypt.checkpw()` / `bcrypt.hashpw()`); hash format (`$2b$...`) is identical so existing hashes remain valid

### Hotfix: Geist font loading `eb9e55b`

- **Root cause** — `geist@1.3.1` ships only `.woff2` files; no CSS exists at `dist/geist.css` or `dist/geist-mono.css` (package is designed for Next.js font API)
- **Fix** — Dockerfile now copies font files from `node_modules/geist/dist/fonts/` into `public/fonts/` before the Vite build; `index.css` replaced broken `@import` lines with explicit `@font-face` declarations referencing `/fonts/geist-sans/` and `/fonts/geist-mono/`

- **Design system** — CSS custom properties for full light/dark palette (`styles/design-system.css`); Geist font; all tokens from CLAUDE.md (accent, risk, status, shadow, radius, text sizes); theme toggle persists to localStorage; OS `prefers-color-scheme` respected on first load
- **AuthContext** — IR/vendor sessions in sessionStorage, admin in localStorage; typed login/logout helpers for all three roles
- **EvaluationLogin.jsx** — centered email form; token from URL params; generic error message on failure
- **EvaluationPortal.jsx** — sticky header with status badge + dark mode toggle; drag-and-drop upload zones for Functional Evaluation, NDA, SOW; file list with size + delete; inline save confirmation; read-only once DD dispatched
- **VendorLogin.jsx** — auth gate at `/respond/:token`; shows email form if session absent or token mismatch
- **VendorQuestionnaire.jsx** — sticky header; questions grouped by section with Q-number + required indicator; AI addendum sections conditional on `is_ai_application`; 800ms debounced autosave; FILE_UPLOAD questions with drag-and-drop; read-only overlay when status outside `{DD_SENT_UNOPENED, DD_IN_PROGRESS}`; submit confirmation modal
- **App.jsx** — BrowserRouter with basename, routes for evaluation + vendor portals; theme initialised before first render to prevent flash

---

## Phase 2 — COMPLETE ✅

### Backend additions

- **Structured fields router** — `routers/admin/structured_fields.py`: `GET /api/admin/engagements/{id}/structured-fields` (returns `null` if no record yet, never 404); `PATCH /api/admin/engagements/{id}/structured-fields` (creates on first call, partial updates via `model_dump(exclude_unset=True)`); all mutations audit-logged
- **Risk assessment router** — `routers/admin/risk_assessment.py`:
  - `POST /api/admin/engagements/{id}/risk-assessment` — creates DRAFT; 409 if already exists
  - `GET /api/admin/engagements/{id}/risk-assessment` — returns full assessment including `risk_items`
  - `PATCH /api/admin/engagements/{id}/risk-assessment` — updates `overall_rating`, `summary`, and/or `risk_items`; risk items replaced atomically (delete-all then re-insert); all post-write returns use `execution_options(populate_existing=True)` to bypass SQLAlchemy identity map cache
  - `POST /api/admin/engagements/{id}/risk-assessment/finalise` — sets FINALISED; if engagement is `RISK_ASSESSMENT_PENDING` auto-advances to `CLOSED` (NDA + SOW both present) or `PENDING_CLOSURE` (either missing); status change audit-logged by "system" actor
  - `POST /api/admin/engagements/{id}/risk-assessment/reopen` — returns to DRAFT
- **Lifecycle enforcement for set-status** — `POST /{id}/set-status` to `CLOSED` or `PENDING_CLOSURE` now requires a finalised risk assessment; returns 400 with explanatory message if not present
- **Word export** — `services/export.py` using `python-docx`; entry point `generate_export(engagement_id, db) -> bytes`; five sections:
  1. Cover page — application name, OC names joined, document number, export date
  2. Document Control — version table (v1.0 pre-filled)
  3. Executive Summary — Phase 3 scaffold placeholder
  4. Risk Assessment — overall rating badge, summary, risk register table (description, rating colour-coded, assigned to, mitigation); empty scaffold if no RA
  5. DDQ — all questions + responses grouped by section; AI addendum as labelled sub-section; images embedded inline; PDFs noted as `[Attachment: filename — see uploaded files]`
  - Font: Dax (falls back to Arial); Albatha navy `#1F3864` / blue `#2E75B6` headings; risk colours per spec; navy table headers with white text; `#F2F2F2` alternating rows
- `GET /api/admin/engagements/{id}/export` — returns `.docx` bytes with correct `Content-Disposition` header
- **Pydantic schemas** — `StructuredFieldsUpdate`, `StructuredFieldsResponse` added to `schemas/engagement.py`; `RiskItemCreate`, `RiskItemResponse`, `RiskAssessmentCreate`, `RiskAssessmentUpdate`, `RiskAssessmentResponse` in `schemas/risk_assessment.py`
- **Router registration** — `main.py` registers `admin_risk_assessment_router` and `admin_structured_fields_router` under `/api/admin`

### Frontend additions

- **Admin login** (`pages/admin/Login.jsx`) — centered card matching design system; POST to `/api/admin/auth/login`; stores JWT via `AuthContext.loginAdmin()`; redirects to dashboard
- **AdminLayout** (`components/admin/AdminLayout.jsx`) — 220px fixed sidebar; NavLink active state (accent-subtle bg, 2px left border, accent text); dark mode toggle (sun/moon icon, reads/writes `localStorage.theme`, toggles `data-theme` on `<html>`); logout button at bottom; `ProtectedAdmin` HOC redirects unauthenticated users to `/admin/login`
- **Dashboard** (`pages/admin/Dashboard.jsx`) — paginated engagement table (50/page); columns: document number (Geist Mono, blue), application name, operating companies, status badge, AI badge, created date, submitted date; status filter dropdown; search-by-name form; row click navigates to detail
- **New Engagement** (`pages/admin/NewEngagement.jsx`) — application name input; OC checkboxes (loaded from settings); `EmailTagInput` chip component for vendor_emails and ir_emails (Enter/comma adds, Backspace removes, blur commits); AI application checkbox; internal notes textarea; client-side validation before submit
- **Engagement Detail** (`pages/admin/EngagementDetail.jsx`) — four-tab layout:
  - *Overview* — engagement info grid (doc number, status badge, dates, vendor/IR emails with inline `EmailEditRow` editor, tokens); 9-field structured fields grid with Save button and disabled "Extract with AI" `AIButton` with tooltip
  - *Risk Assessment* — create button if no RA; form with overall rating select and summary textarea; risk items list with `RiskItemRow` (description, rating select, assignee multi-select chip dropdown with outside-click close, mitigation textarea); add/remove items; Save Draft, Finalise, Reopen buttons; disabled "Generate with AI" `AIButton`
  - *Responses* — read-only question/answer list grouped by section; file download links for FILE_UPLOAD responses
  - *Audit Log* — paginated table (actor, type, action, description, timestamp)
  - Lifecycle action buttons conditional on current status: Advance to IR Stage (DRAFT), Dispatch to Vendor (PENDING_DISPATCH), Reopen Questionnaire (RISK_ASSESSMENT_PENDING), Move to Under Review (CLOSED / PENDING_CLOSURE), Close Engagement (PENDING_CLOSURE and UNDER_REVIEW)
  - Export button fetches `.docx` blob and triggers browser download
- **Settings** (`pages/admin/Settings.jsx`) — Operating Companies CRUD (add, inline edit, delete); Assignees CRUD (name + type label); generic error display; all mutations refresh the list
- **App.jsx** — added `ProtectedAdmin` wrapper; registered `/admin/login`, `/admin/dashboard`, `/admin/engagements/new`, `/admin/engagements/:id`, `/admin/settings`

### Lifecycle refinement: PENDING_DISPATCH + FE deletion lock

- **New `PENDING_DISPATCH` status** — inserted between `FUNCTIONAL_EVALUATION_PENDING` and `DD_IN_PROGRESS`. IR uploading the functional evaluation moves the engagement to `PENDING_DISPATCH`. Admin explicitly dispatches it via the "Dispatch to Vendor" button.
- **`POST /api/admin/engagements/{id}/dispatch`** — new admin endpoint; transitions `PENDING_DISPATCH → DD_IN_PROGRESS`; audit-logged as `engagement.dispatched`.
- **"Dispatch to Vendor" button** — appears in the engagement detail header when status is `PENDING_DISPATCH`; calls the new dispatch endpoint.
- **Alembic migration `0002`** — `ALTER TYPE engagementstatus ADD VALUE IF NOT EXISTS 'PENDING_DISPATCH' AFTER 'FUNCTIONAL_EVALUATION_PENDING'`; runs automatically on backend startup.
- **IR functional evaluation deletion lock** — the FE file is freely deletable while status is `FUNCTIONAL_EVALUATION_PENDING` or `PENDING_DISPATCH`. Once the engagement reaches `DD_IN_PROGRESS` or beyond, attempting to delete the FE returns HTTP 403. NDA and SOW remain freely deletable at any status.
- **Dashboard + status badge** — `PENDING_DISPATCH` added to `STATUS_LABELS` and `STATUS_COLORS` in both Dashboard and EngagementDetail; rendered in teal (`--status-pending-dispatch: #0891B2`).

### Lifecycle simplification: remove DD_SENT_UNOPENED + IR vendor responses tab

- **`DD_SENT_UNOPENED` removed** — the status was redundant once the IR portal gained a read-only responses view. The distinction between "dispatched but unopened" and "in progress" is now expressed through response count rather than a separate lifecycle state. `PENDING_DISPATCH → DD_IN_PROGRESS` is now a direct transition; dispatch sets `DD_IN_PROGRESS` immediately.
- **Vendor editable window** — reduced from `{DD_SENT_UNOPENED, DD_IN_PROGRESS}` to `{DD_IN_PROGRESS}` only. No behaviour change since dispatch now sets `DD_IN_PROGRESS` directly.
- **Removed auto-advancement in vendor save** — the backend no longer advances status on first vendor save (it was already `DD_IN_PROGRESS`). Frontend lifecycle-advancement block in `VendorQuestionnaire.jsx` removed accordingly.
- **IR portal: Vendor Responses tab** — two-tab layout added to `EvaluationPortal.jsx`. Tab 1: Pre-DD Documents (unchanged). Tab 2: Vendor Responses — visible from `DD_IN_PROGRESS` onwards; fetches `GET /api/evaluation/engagements/{token}/responses`; grouped by section; shows Q-number, question text, vendor answer (or "No answer entered"), and last-updated timestamp per response.
- **`0001_initial_schema.py`** — `DD_SENT_UNOPENED` removed from the `engagementstatus` enum definition. Existing DB must be wiped and rebuilt (`docker compose down -v && docker compose up --build`).

### UNDER_REVIEW vendor editing + smart close

- **`UNDER_REVIEW` now editable for vendor** — `EDITABLE_STATUSES` on both backend and frontend expanded to include `UNDER_REVIEW`. Vendor can autosave responses and upload/delete files while the engagement is under review (intended for cases where a response changes months after initial closure). The Submit button is controlled separately via `SUBMIT_STATUSES = {DD_IN_PROGRESS}` — submit is not available in `UNDER_REVIEW` since the vendor's changes are visible to admin in real-time via the IR portal responses tab.
- **Info banner in vendor questionnaire** — `UNDER_REVIEW` status shows a blue informational notice: "This engagement is under review. You may update your responses — changes are saved automatically."
- **Smart close endpoint** — `POST /api/admin/engagements/{id}/close` for closing from `UNDER_REVIEW`. The endpoint queries IR documents (NDA + SOW) and auto-routes to `CLOSED` if both present, or `PENDING_CLOSURE` if either is missing. The admin can no longer manually select the wrong close state.

### Inline email editing in Engagement Detail

- **`EmailEditRow` component** — replaces the static `InfoRow` for Vendor Emails and IR Emails in `EngagementDetail.jsx`. View mode shows current addresses with an Edit button. Edit mode shows each address as a removable chip; a text input with Enter/Add adds new addresses with format validation and duplicate detection; Save PATCHes `{ vendor_emails }` or `{ ir_emails }` to `/api/admin/engagements/{id}` and refreshes the engagement. No backend changes required.

### Admin file deletion with password confirmation

- **`DELETE /api/admin/engagements/{id}/files/{file_id}`** — new endpoint; accepts `{ "password": "..." }` in the request body; verifies the password against `settings.admin_password_hash` via bcrypt; returns 403 if incorrect. On success: deletes the DB record, writes an `file.admin_delete` audit log entry, commits, then removes the file from disk. No lifecycle-state restrictions — admin can delete any file at any status.
- **`AdminFileDeleteRequest` Pydantic model** — `password: str` field; defined inline in `routers/admin/engagements.py`.
- **`verify_password` import** — `services/auth.py::verify_password` imported into the engagements router for the password check.
- **`DeleteFileModal` component** — password confirmation modal in `EngagementDetail.jsx`; auto-focuses the password input; shows inline error on wrong password; calls the delete endpoint; on success removes the file from local state and closes the modal. Clicking the overlay or Cancel closes without action.
- **Delete button in FilesTab** — red "Delete" button (`btn-danger`) alongside the existing Download button on every file row (both IR Documents and Vendor Attachments sections); clicking opens the `DeleteFileModal` for that specific file.

### PENDING_CLOSURE + IR document lock

- **`CLOSED_PENDING_IR_DOCS` renamed to `PENDING_CLOSURE`** — enum value updated in model, migration, lifecycle, and all routers. Frontend STATUS_LABELS updated across Dashboard, EngagementDetail, EvaluationPortal, VendorQuestionnaire.
- **Removed auto-advance to CLOSED** — IR uploading NDA/SOW no longer automatically advances the engagement from `PENDING_CLOSURE` to `CLOSED`. The transition is now a manual admin action.
- **`POST /api/admin/engagements/{id}/close-from-pending`** — new endpoint; validates engagement is in `PENDING_CLOSURE` and risk assessment is finalised; transitions to `CLOSED`.
- **"Close Engagement" button in PENDING_CLOSURE** — shown in the engagement detail header alongside "Move to Under Review"; calls the new endpoint.
- **IR document lock on CLOSED** — `POST /{token}/files` and `DELETE /{token}/files/{id}` in the evaluation router now return HTTP 403 if engagement status is `CLOSED`. The IR portal shows a locked notice and hides upload zones and delete buttons when status is `CLOSED`.

---

## Phase 3 — Not started

- [ ] Claude API integration for field extraction (`services/extraction.py`)
- [ ] Claude API integration for risk assessment generation (`services/risk_ai.py`)
- [ ] Email notification wiring — SMTP for vendor link, IR link, submission alert (`services/notifications.py`)

---

## Phase 4 — Not started

- [ ] JSON import with review-before-save flow
- [ ] AI-powered Word import via Claude API
