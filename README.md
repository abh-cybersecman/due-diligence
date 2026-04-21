# ISDD Portal

Information Security Due Diligence portal for ABH IT. Replaces the email-based vendor questionnaire process with a containerised web application used by three distinct user types: the Information Security Team (admin), IT Representatives (IR), and external vendors.

---

## Features

### Admin Portal

**Engagement management**
- Create engagements for applications undergoing due diligence. Each engagement gets an auto-generated document number (`ABHIT-IST-DD-XXXX`), unique vendor and IR access tokens, and can be tagged to one or more Operating Companies.
- Dashboard with search-by-name and status filters; paginated table showing document number, application, OCs, status badge, AI flag, created/submitted dates.
- Inline editing of engagement metadata including application name, OC associations, vendor/IR email lists, and internal notes.

**Lifecycle state machine**
The engagement moves through a defined set of statuses, with transitions enforced server-side:

```
DRAFT
  → FUNCTIONAL_EVALUATION_PENDING    (admin triggers manually)
  → PENDING_DISPATCH                 (automatic: IR uploads functional evaluation)
  → DD_IN_PROGRESS                   (admin clicks "Dispatch to Vendor")
  → RISK_ASSESSMENT_PENDING          (automatic: vendor submits)
  → CLOSED / CLOSED_PENDING_IR_DOCS  (admin finalises risk assessment)
  → UNDER_REVIEW                     (admin manually reopens closed engagement)
```

`PENDING_DISPATCH` indicates the functional evaluation has been received and the vendor questionnaire is ready to go — the admin explicitly dispatches it rather than the link going live automatically.

`DD_IN_PROGRESS` covers the full active questionnaire window, from dispatch through to vendor submission. The IR portal shows a read-only Vendor Responses tab once this status is reached.

`CLOSED_PENDING_IR_DOCS` auto-resolves to `CLOSED` the moment both NDA and SOW are uploaded by IR.

**Engagement Details panel**
Vendor and IR email lists are editable inline — click Edit next to either field to enter edit mode. Add emails one at a time (Enter or Add button, with format validation and duplicate detection); remove individual emails via the chip × button; Save commits via `PATCH /api/admin/engagements/{id}`.

**Structured fields panel**
Nine key technical fields extracted from the questionnaire responses (service type, hosting location, hyperscaler, DR location, data residency, encryption at rest/in transit, MFA support). All editable by admin at any lifecycle stage. "Extract with AI" button is present and will be wired to the Claude API in Phase 3.

**Risk assessment panel**
- Create a draft risk assessment on any engagement.
- Add, edit, and reorder risk items: each has a description, risk rating (Critical/High/Medium/Low), one or more assignees (drawn from the configurable assignee list), and a mitigation note.
- Set an overall risk rating and free-text summary.
- Finalise the assessment — this triggers the engagement to advance from `RISK_ASSESSMENT_PENDING` to `CLOSED` or `CLOSED_PENDING_IR_DOCS` depending on whether both IR documents (NDA + SOW) are present.
- Reopen a finalised assessment to DRAFT for revision.
- Engagements cannot be manually set to CLOSED without a finalised risk assessment.
- "Generate with AI" button is present and will be wired to the Claude API in Phase 3.

**Responses view**
Read-only view of all vendor questionnaire answers, grouped by section. File upload questions show download links. All files are served through an authenticated endpoint — never directly from disk.

**Audit log**
Every action in the system is recorded: auth events, status transitions, file uploads/deletes, field edits, submissions. Viewable per-engagement and system-wide, with actor, action key, human-readable description, and JSONB metadata.

**Word export**
Generates a `.docx` file matching the Albatha DD template:
- Cover page (application name, OCs, document number, export date)
- Document Control table
- Executive Summary (Phase 3 scaffold)
- Risk Assessment section (overall rating, summary, colour-coded risk register table)
- Full questionnaire by section including AI addendum; images embedded inline; PDFs noted with filename

**Settings**
- Operating Companies list — add/edit/delete; used on the New Engagement form and appears in exports.
- Assignees list — name + type label (e.g. "Vendor", "ABH IT"); used in the risk assessment assignee selector.

---

### IT Representative (IR) Portal

Accessed at `/due-diligence/evaluation/:token` — the token is generated when the engagement is created and is sent to IR email addresses.

- Email verification gate: IR enters their email, which is checked against the `ir_emails` list on the engagement.
- Upload three categories of documents: Functional Evaluation, NDA, SOW.
- Uploading a Functional Evaluation automatically advances the engagement from `FUNCTIONAL_EVALUATION_PENDING` to `PENDING_DISPATCH`. The admin must then explicitly click **Dispatch to Vendor** to issue the questionnaire link.
- The Functional Evaluation cannot be deleted once the questionnaire has been dispatched (`DD_IN_PROGRESS` or later). It can be replaced before dispatch if the wrong file was uploaded.
- Uploading both NDA and SOW when the engagement is `CLOSED_PENDING_IR_DOCS` automatically advances it to `CLOSED`.
- Two-tab layout: **Pre-DD Documents** (upload) and **Vendor Responses** (read-only, visible from `DD_IN_PROGRESS` onwards). The Vendor Responses tab shows all vendor answers grouped by section with last-updated timestamps.
- Dark mode toggle; status badge in header.

---

### Vendor Portal

Accessed at `/due-diligence/respond/:token` — the token is generated when the engagement is created and is sent to vendor email addresses.

- Email verification gate: vendor enters their email, checked against `vendor_emails`. JWT is scoped to this specific engagement and validated on every request.
- 43-question security questionnaire (Q1–30 standard; Q31–43 AI addendum, shown only for AI applications).
- 800ms debounced autosave; progress is preserved across sessions.
- FILE_UPLOAD questions (Q9, Q10 — architecture diagrams) support drag-and-drop with per-file and total size limits.
- Form becomes read-only once submitted or if the engagement moves out of the active DD window.
- Submit confirmation modal; submission advances engagement to `RISK_ASSESSMENT_PENDING`.

---

### Security Controls

All of these are enforced server-side, not just client-side:

- **File uploads**: magic byte validation (`python-magic`) before writing to disk; Pillow `verify()` on image files; UUID4 filename with no extension stored on disk; files stored in Docker volumes outside the web root; served only through authenticated API endpoints; per-file, per-engagement count, and per-engagement total size limits checked before touching the filesystem.
- **JWT scoping**: vendor and IR tokens carry the `engagement_id` in the payload; every single vendor/IR endpoint validates that the token's `engagement_id` matches the engagement being accessed.
- **Input sanitisation**: `bleach` applied to all vendor/IR text inputs at write time; React JSX handles output encoding.
- **Auth failures**: always return generic 401/403 — never indicate which credential was wrong; all failures are audit-logged.
- **SQL**: SQLAlchemy ORM throughout — no raw SQL strings.
- **Secrets**: all configuration via environment variables; nothing hardcoded.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, served via nginx |
| Backend | Python 3.11 / FastAPI (async) |
| Database | PostgreSQL 15 |
| ORM | SQLAlchemy 2.0 (async) + Alembic |
| Auth | python-jose (JWT) + bcrypt |
| File validation | python-magic + Pillow |
| Word export | python-docx |
| Input sanitisation | bleach |
| Containerisation | Docker + Docker Compose |

---

## Getting Started

### Prerequisites

- Docker and Docker Compose
- `python3` available locally (only needed to generate the initial password hash)

### 1. Clone and configure

```bash
git clone <repo-url>
cd DueDiligence
cp .env.example .env
```

### 2. Generate the admin password hash

The admin password is stored as a bcrypt hash in `.env`. Generate one:

```bash
python3 -c "import bcrypt; print(bcrypt.hashpw(b'your-password-here', bcrypt.gensalt()).decode())"
```

Copy the output into `.env`:

```env
ADMIN_PASSWORD_HASH=$2b$12$...
```

### 3. Set a strong JWT secret

Replace the placeholder in `.env`:

```env
JWT_SECRET_KEY=replace-with-a-long-random-string
```

Generate one with:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 4. Review other settings

Key variables in `.env`:

| Variable | Default | Notes |
|---|---|---|
| `ADMIN_USERNAME` | `admin` | Login username |
| `ADMIN_PASSWORD_HASH` | *(required)* | bcrypt hash of the admin password |
| `JWT_SECRET_KEY` | *(required)* | Must be changed in production |
| `POSTGRES_PASSWORD` | `changeme` | Change in production |
| `APP_BASE_PATH` | `/due-diligence` | Subpath the app is served under |
| `DOC_NUMBER_PREFIX` | `ABHIT-IST-DD-` | Prefix for document numbers |
| `DOC_NUMBER_START` | `1001` | First document number |
| `VENDOR_MAX_FILE_SIZE_MB` | `25` | Per-file limit for vendor uploads |
| `VENDOR_MAX_TOTAL_UPLOAD_MB` | `100` | Total upload limit per engagement |
| `IR_MAX_FILE_SIZE_MB` | `25` | Per-file limit for IR uploads |
| `IR_MAX_TOTAL_UPLOAD_MB` | `100` | Total upload limit per engagement |

### 5. Build and start

```bash
docker compose up -d --build
```

On first start, the backend will:
1. Wait for PostgreSQL to be healthy
2. Run `alembic upgrade head` to create all tables
3. Seed all 43 questionnaire questions if the table is empty
4. Start uvicorn

### 6. Access the application

| URL | Description |
|---|---|
| `http://localhost:3310/due-diligence/admin/login` | Admin portal |
| `http://localhost:3310/due-diligence/evaluation/:token` | IR portal (token from engagement detail) |
| `http://localhost:3310/due-diligence/respond/:token` | Vendor portal (token from engagement detail) |

The backend API is also directly accessible at `http://localhost:8000/due-diligence/api/`.

### 7. Create your first engagement

1. Log in at `/due-diligence/admin/login`
2. Go to Settings → add at least one Operating Company and any assignees you want available in the risk register
3. Click **+ New Engagement** on the dashboard
4. Fill in the application name, select OCs, enter vendor and IR email addresses
5. Click **Create Engagement** — the engagement is created in DRAFT status with vendor and IR access tokens generated
6. From the engagement detail page, click **Advance to IR Stage** to move to `FUNCTIONAL_EVALUATION_PENDING` and share the IR token link with the IR team

---

## Ports

| Service | Port |
|---|---|
| Frontend (nginx) | 3310 |
| Backend (uvicorn) | 8000 |
| PostgreSQL | not exposed externally |

---

## Data Persistence

Three named Docker volumes:

| Volume | Contents |
|---|---|
| `postgres_data` | PostgreSQL database files |
| `uploads` | Vendor attachments + IR documents (stored with UUID filenames) |
| `backups` | Database backups (Phase 3) |

Files are never stored inside the container image — they persist across `docker compose down` / `up` cycles.

---

## Deployment

The application is designed to run behind a WAF at `vendorportal.albatha.com` under the `/due-diligence` subpath.

**Required WAF rules (not implemented in this codebase):**
- `/due-diligence/respond/*` and `/due-diligence/api/vendor/*` → allow all IPs (vendor-facing)
- `/due-diligence/evaluation/*`, `/due-diligence/admin/*`, `/due-diligence/api/evaluation/*`, `/due-diligence/api/admin/*` → restrict to ABH corporate IP ranges and VPN egress IPs only

If deploying without a WAF, admin and IR routes will be publicly accessible — this is a critical security misconfiguration.

---

## Build Status

| Phase | Status |
|---|---|
| Phase 1 — Foundation, vendor portal, IR portal | Complete |
| Phase 2 — Admin UI, risk assessment, structured fields, Word export | Complete |
| Phase 3 — Claude AI integration, email notifications, database backup | Not started |
| Phase 4 — JSON/Word import | Not started |
