# ISDD Portal — Claude Code Instructions

## Project Overview

This is the **Information Security Due Diligence (ISDD) Portal** for Albatha (ABH IT). It replaces an email-based vendor questionnaire process with a containerized web application.

Three user types exist:
- **Admin** (Information Security Team) — manages engagements, reviews responses, performs risk assessments
- **IT Representative (IR)** — uploads pre-DD documents (functional evaluation, NDA, SOW) via an internal-only portal
- **Vendor** — completes the security questionnaire via a public-facing portal

The system is built in four phases. Build phases in order. Do not skip ahead.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (single-page app) |
| Backend | Python 3.11+ / FastAPI |
| Database | PostgreSQL 15+ |
| ORM | SQLAlchemy (async) + Alembic migrations |
| Containerization | Docker + Docker Compose |
| Word Export | python-docx |
| File Validation | Pillow + python-magic |
| DB Backup | pg_dump |

---

## UI Design System

### Aesthetic Direction

The ISDD Portal is an **internal security operations tool** used by the Information Security Team, IT Representatives, and external vendors completing formal assessments. The design must feel:

- **Mature and authoritative** — this is a compliance and risk tool, not a consumer product. It should feel like something a CISO would trust.
- **Refined and professional** — clean, structured, high information density without feeling cluttered. Think enterprise-grade dashboards like Linear or a well-designed audit platform.
- **Calm and focused** — muted palette, no gratuitous animations, no playfulness. Motion is used only for purposeful transitions.

Do not use generic AI aesthetics: no purple gradients, no rounded bubbly cards, no Inter/Roboto. This is not a SaaS marketing site.

---

### Light / Dark Mode

The application **must support both light and dark mode**. Implement using CSS custom properties on `:root` and a `[data-theme="dark"]` attribute on `<html>`. The user's OS preference (`prefers-color-scheme`) is the default; users can toggle manually and the preference persists in `localStorage`.

**Light mode palette:**
```css
:root {
  --bg-primary:     #F8F9FA;
  --bg-surface:     #FFFFFF;
  --bg-subtle:      #F1F3F5;
  --bg-muted:       #E9ECEF;

  --text-primary:   #1A1D23;
  --text-secondary: #4A5568;
  --text-muted:     #718096;
  --text-inverse:   #FFFFFF;

  --border:         #DEE2E6;
  --border-strong:  #ADB5BD;

  --accent:         #1F3864;   /* Albatha navy — primary actions */
  --accent-hover:   #162B4D;
  --accent-subtle:  #EBF0F8;

  --blue:           #2E75B6;
  --blue-subtle:    #E8F1F8;

  --risk-critical:    #EE0000;
  --risk-high:        #C00000;
  --risk-medium:      #FFC000;
  --risk-low:         #70AD47;
  --risk-critical-bg: #FFF0F0;
  --risk-high-bg:     #FFF0F0;
  --risk-medium-bg:   #FFFBF0;
  --risk-low-bg:      #F0FFF0;

  --status-draft:          #718096;
  --status-ir-pending:     #2E75B6;
  --status-dd-sent:        #805AD5;
  --status-dd-progress:    #D69E2E;
  --status-risk-pending:   #DD6B20;
  --status-closed:         #70AD47;
  --status-closed-pending: #E53E3E;
  --status-under-review:   #2B6CB0;

  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.10);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
}
```

**Dark mode palette:**
```css
[data-theme="dark"] {
  --bg-primary:     #0F1117;
  --bg-surface:     #1A1D23;
  --bg-subtle:      #21262D;
  --bg-muted:       #2D333B;

  --text-primary:   #E6EDF3;
  --text-secondary: #8B949E;
  --text-muted:     #6E7681;
  --text-inverse:   #0F1117;

  --border:         #30363D;
  --border-strong:  #484F58;

  --accent:         #4A7FBF;
  --accent-hover:   #5A8FD0;
  --accent-subtle:  #1A2A3D;

  --blue:           #58A6FF;
  --blue-subtle:    #1A2840;

  --risk-critical-bg: #2D1515;
  --risk-high-bg:     #2D1515;
  --risk-medium-bg:   #2D2410;
  --risk-low-bg:      #162010;

  --shadow-sm: 0 1px 3px rgba(0,0,0,0.30);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.40);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.50);
}
```

---

### Typography

Use **[Geist](https://vercel.com/font)** (free, `npm install geist`) — a clean, modern, slightly technical sans-serif that reads well at small sizes in data-dense interfaces. Appropriate for a security tool without feeling clinical.

- Headings: Geist, weight 600
- Body / labels: Geist, weight 400
- Monospace (document numbers, tokens): Geist Mono

```css
--text-xs:   11px;
--text-sm:   13px;
--text-base: 14px;
--text-md:   15px;
--text-lg:   18px;
--text-xl:   22px;
--text-2xl:  28px;
```

---

### Layout

**Admin dashboard**: fixed left sidebar (220px) + scrollable main content area.

**Vendor and IR portals**: centered single-column layout (max-width 760px) with a top header bar showing application name and current engagement status.

All panels, cards, and tables use `var(--bg-surface)` with `var(--border)` borders and `var(--shadow-sm)`. Depth comes from tonal difference between surface and background, not heavy shadows.

---

### Component Conventions

**Tables** (dashboard, risk register, audit log)
- Header: `var(--bg-subtle)`, text `var(--text-secondary)`, weight 500, uppercase, letter-spacing 0.04em, `var(--text-xs)`
- Alternating rows: white / `var(--bg-subtle)`
- Row hover: `var(--accent-subtle)`
- Horizontal dividers only — no outer border

**Status and risk badges**
- Pill shape: `border-radius: 100px`, padding `2px 8px`, `var(--text-xs)`, weight 500
- Status colors from `--status-*` vars; risk colors from `--risk-*` vars
- In the risk register table, apply `--risk-*-bg` tint to the entire rating cell

**Buttons**
- Primary: `var(--accent)` bg, white text, height 34px, padding `0 14px`, `var(--radius-sm)`
- Secondary: `var(--bg-subtle)` bg, `var(--border)` border
- Destructive: `var(--risk-high)` bg, white text
- Disabled: 40% opacity, `cursor: not-allowed`
- AI-feature buttons (disabled): show tooltip on hover — "AI extraction coming in a future phase" / "AI risk assessment coming in a future phase"

**Inputs / forms**
- Height 34px, `var(--border)` border, `var(--radius-sm)`
- Focus: 2px solid `var(--accent)`, offset 1px — no glow
- Textarea: min-height 80px, resize vertical only
- Multi-select: tag/chip style — selected items render as small removable chips inside the input field

**File upload zones**
- Dashed `var(--border)`, `var(--bg-subtle)` background
- Drag-over / hover: solid `var(--accent)` border, `var(--accent-subtle)` background
- Show running count and total size used vs. limit below the zone

**Sidebar navigation**
- Active: `var(--accent-subtle)` bg, 2px solid `var(--accent)` left border, `var(--accent)` text
- Hover: `var(--bg-subtle)` bg
- Section labels: uppercase, `var(--text-muted)`, `var(--text-xs)`

---

### Motion

Purposeful and fast. No decorative animations.

```css
/* Interactive elements */
transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;

/* Panel / page load */
.fade-in {
  animation: fadeIn 200ms ease forwards;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Theme switch */
html { transition: background-color 200ms ease, color 200ms ease; }
```

Status saves show a brief inline confirmation (checkmark + "Saved", fades after 1.5s) — no toast library needed.

---

### Dark Mode Toggle

Sun/moon icon button at the bottom of the admin sidebar and in the top-right of vendor/IR portal headers. On click: toggle `data-theme="dark"` on `<html>`, persist to `localStorage` as `"theme": "dark" | "light"`. On app load: read `localStorage` first, fall back to `prefers-color-scheme`.

---



```
isdd-portal/
├── docker-compose.yml
├── .env.example
├── CLAUDE.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   ├── app/
│   │   ├── main.py               # FastAPI app, base path config, CORS
│   │   ├── config.py             # Settings from env vars
│   │   ├── database.py           # SQLAlchemy async engine + session
│   │   ├── models/               # SQLAlchemy ORM models
│   │   │   ├── __init__.py
│   │   │   ├── engagement.py
│   │   │   ├── question.py
│   │   │   ├── response.py
│   │   │   ├── file_upload.py
│   │   │   ├── risk_assessment.py
│   │   │   ├── audit_log.py
│   │   │   └── settings.py
│   │   ├── schemas/              # Pydantic request/response schemas
│   │   │   ├── engagement.py
│   │   │   ├── response.py
│   │   │   ├── risk_assessment.py
│   │   │   └── auth.py
│   │   ├── routers/
│   │   │   ├── admin/
│   │   │   │   ├── auth.py
│   │   │   │   ├── engagements.py
│   │   │   │   ├── settings.py
│   │   │   │   └── backup.py
│   │   │   ├── evaluation/
│   │   │   │   ├── auth.py
│   │   │   │   └── engagements.py
│   │   │   └── vendor/
│   │   │       ├── auth.py
│   │   │       └── engagements.py
│   │   ├── services/
│   │   │   ├── auth.py           # JWT creation/validation, password hashing
│   │   │   ├── files.py          # Upload handling, validation, storage
│   │   │   ├── export.py         # Word document generation (python-docx)
│   │   │   ├── backup.py         # pg_dump + archive creation
│   │   │   ├── audit.py          # Audit log writing
│   │   │   ├── extraction.py     # STUB: AI field extraction
│   │   │   ├── risk_ai.py        # STUB: AI risk assessment
│   │   │   └── notifications.py  # STUB: email notifications
│   │   ├── seed/
│   │   │   └── questions.json    # Seeded questionnaire (Q1–43)
│   │   └── utils/
│   │       ├── sanitize.py       # XSS/injection sanitization
│   │       └── tokens.py         # UUID token generation
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── public/
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── config.js             # BASE_PATH, API_URL from env
│       ├── contexts/
│       │   └── AuthContext.jsx
│       ├── pages/
│       │   ├── admin/
│       │   │   ├── Login.jsx
│       │   │   ├── Dashboard.jsx
│       │   │   ├── EngagementDetail.jsx
│       │   │   ├── NewEngagement.jsx
│       │   │   └── Settings.jsx
│       │   ├── evaluation/
│       │   │   ├── EvaluationLogin.jsx
│       │   │   └── EvaluationPortal.jsx
│       │   └── vendor/
│       │       ├── VendorLogin.jsx
│       │       └── VendorQuestionnaire.jsx
│       └── components/
│           ├── shared/
│           ├── admin/
│           ├── evaluation/
│           └── vendor/
└── nginx/
    └── nginx.conf                # Reverse proxy config (reference only)
```

---

## Environment Variables

All configuration via `.env`. Never hardcode secrets. Create `.env.example` with all keys and empty/example values.

```env
# Database
POSTGRES_DB=isdd
POSTGRES_USER=isdd_user
POSTGRES_PASSWORD=changeme
DATABASE_URL=postgresql+asyncpg://isdd_user:changeme@db:5432/isdd

# Admin credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<bcrypt hash>

# JWT
JWT_SECRET_KEY=changeme
JWT_ALGORITHM=HS256
ADMIN_JWT_EXPIRE_MINUTES=480
VENDOR_JWT_EXPIRE_MINUTES=120
IR_JWT_EXPIRE_MINUTES=120

# App
APP_BASE_PATH=/due-diligence

# File storage
UPLOAD_DIR=/app/uploads
IR_UPLOAD_DIR=/app/uploads/ir
BACKUP_DIR=/app/backups

# Upload limits (vendor)
VENDOR_MAX_FILE_SIZE_MB=25
VENDOR_MAX_FILES_PER_ENGAGEMENT=20
VENDOR_MAX_TOTAL_UPLOAD_MB=100

# Upload limits (IR)
IR_MAX_FILE_SIZE_MB=25
IR_MAX_FILES_PER_ENGAGEMENT=20
IR_MAX_TOTAL_UPLOAD_MB=100

# Document numbering
DOC_NUMBER_START=1001
DOC_NUMBER_PREFIX=ABHIT-IST-DD-

# AI (Phase 3 — leave blank until Phase 3)
ANTHROPIC_API_KEY=
```

---

## Docker Compose

Three services: `frontend`, `backend`, `db`. Plus named volumes for uploads and backups.

```yaml
# docker-compose.yml structure
services:
  db:
    image: postgres:15
    volumes:
      - postgres_data:/var/lib/postgresql/data
    env_file: .env

  backend:
    build: ./backend
    depends_on: [db]
    volumes:
      - uploads:/app/uploads
      - backups:/app/backups
    env_file: .env

  frontend:
    build: ./frontend
    depends_on: [backend]
    env_file: .env

volumes:
  postgres_data:
  uploads:
  backups:
```

Alembic migrations run automatically on backend startup via an entrypoint script (`alembic upgrade head` before uvicorn starts).

---

## Database Models

### Key rules
- All models use UUID primary keys (not integer autoincrement) except where noted
- Document number (`doc_number`) is a separate `String` column, not the PK, auto-generated as `ABHIT-IST-DD-XXXX` starting at 1001, stored as the full string, editable
- Use SQLAlchemy async session throughout
- All timestamps stored in UTC

### Models to implement

**Engagement**
- id (UUID PK)
- doc_number (String, unique, auto-generated)
- application_name (String)
- operating_companies (relationship to OC list, many-to-many)
- vendor_emails (ARRAY of String)
- ir_emails (ARRAY of String)
- is_ai_application (Boolean)
- internal_notes (Text)
- status (Enum: see lifecycle below)
- vendor_token (UUID, unique)
- ir_token (UUID, unique)
- created_at, updated_at (DateTime UTC)
- submitted_at (DateTime UTC, nullable)

**EngagementStatus enum**
```
DRAFT
FUNCTIONAL_EVALUATION_PENDING
PENDING_DISPATCH
DD_IN_PROGRESS
RISK_ASSESSMENT_PENDING
CLOSED
PENDING_CLOSURE
UNDER_REVIEW
```

**Question**
- id (UUID PK)
- question_number (Integer, unique)
- section (String)
- question_text (Text)
- response_type (Enum: TEXT, SINGLE_CHOICE, MULTI_CHOICE, FILE_UPLOAD)
- is_ai_addendum (Boolean)
- is_required (Boolean)
- order (Integer)

**Response**
- id (UUID PK)
- engagement_id (FK → Engagement)
- question_id (FK → Question)
- response_text (Text, nullable)
- selected_options (ARRAY of String, nullable)
- updated_at (DateTime UTC)

**FileUpload**
- id (UUID PK)
- engagement_id (FK → Engagement)
- question_id (FK → Question, nullable — null for IR documents)
- file_type (Enum: VENDOR_ATTACHMENT, IR_FUNCTIONAL_EVALUATION, IR_NDA, IR_SOW)
- original_filename (String)
- stored_filename (String — UUID-based, no extension that could execute)
- stored_path (String)
- mime_type (String)
- file_size_bytes (Integer)
- uploaded_by (String — vendor email or IR email)
- uploaded_at (DateTime UTC)

**RiskAssessment**
- id (UUID PK)
- engagement_id (FK → Engagement, unique — one per engagement)
- overall_rating (Enum: CRITICAL, HIGH, MEDIUM, LOW, nullable)
- summary (Text, nullable)
- status (Enum: DRAFT, FINALISED)
- created_at, updated_at (DateTime UTC)

**RiskItem**
- id (UUID PK)
- risk_assessment_id (FK → RiskAssessment)
- description (Text)
- rating (Enum: CRITICAL, HIGH, MEDIUM, LOW)
- assigned_to (ARRAY of String)
- mitigation (Text)
- order (Integer)

**StructuredFields**
- id (UUID PK)
- engagement_id (FK → Engagement, unique)
- application_name (String, nullable)
- service_type (String, nullable)
- hosting_location (String, nullable)
- hyperscaler (String, nullable)
- disaster_recovery (String, nullable)
- dr_location (String, nullable)
- data_residency_region (String, nullable)
- encryption_at_rest (String, nullable)
- encryption_in_transit (String, nullable)
- mfa_supported (String, nullable)
- updated_at (DateTime UTC)

**AuditLog**
- id (UUID PK)
- engagement_id (FK → Engagement, nullable)
- actor (String — admin username, vendor email, or IR email)
- actor_type (Enum: ADMIN, VENDOR, IR)
- action (String — machine-readable action key e.g. "engagement.created")
- description (Text — human-readable)
- metadata (JSONB — old/new values for field edits, file names, etc.)
- created_at (DateTime UTC)

**OperatingCompany** (settings)
- id (UUID PK)
- name (String, unique)

**Assignee** (settings)
- id (UUID PK)
- name (String)
- type_label (String, nullable)

---

## API Route Structure

All routes prefixed with `APP_BASE_PATH`. Group by access tier.

```
/api/admin/
  POST   /auth/login
  POST   /auth/logout
  GET    /engagements
  POST   /engagements
  GET    /engagements/{id}
  PATCH  /engagements/{id}
  POST   /engagements/{id}/advance          # Draft → IR stage
  POST   /engagements/{id}/reopen              # RISK_ASSESSMENT_PENDING → DD_IN_PROGRESS
  POST   /engagements/{id}/close-questionnaire # DD_IN_PROGRESS → RISK_ASSESSMENT_PENDING
  POST   /engagements/{id}/set-status          # Manual status changes
  GET    /engagements/{id}/responses
  GET    /engagements/{id}/files/{file_id}  # Authenticated file download
  GET    /engagements/{id}/structured-fields
  PATCH  /engagements/{id}/structured-fields
  GET    /engagements/{id}/risk-assessment
  POST   /engagements/{id}/risk-assessment
  PATCH  /engagements/{id}/risk-assessment
  POST   /engagements/{id}/risk-assessment/finalise
  POST   /engagements/{id}/risk-assessment/reopen
  POST   /engagements/{id}/extract          # STUB Phase 3
  POST   /engagements/{id}/assess-risk      # STUB Phase 3
  GET    /engagements/{id}/export           # Word doc download
  GET    /engagements/{id}/audit
  GET    /audit                             # System-wide audit log
  GET    /settings/oc-list
  POST   /settings/oc-list
  PATCH  /settings/oc-list/{id}
  DELETE /settings/oc-list/{id}
  GET    /settings/assignees
  POST   /settings/assignees
  PATCH  /settings/assignees/{id}
  DELETE /settings/assignees/{id}
  GET    /settings/backup/status
  POST   /settings/backup/trigger          # Requires password re-confirmation
  GET    /settings/backup/download

/api/evaluation/
  POST   /auth/verify                       # Email → IR JWT
  GET    /engagements/{token}/status
  GET    /engagements/{token}/responses     # Read-only once DD in progress
  POST   /engagements/{token}/files         # Upload functional eval / NDA / SOW
  DELETE /engagements/{token}/files/{id}

/api/vendor/
  POST   /auth/verify                       # Email → vendor JWT (scoped to engagement)
  GET    /engagements/{token}               # Form metadata
  GET    /engagements/{token}/responses     # Saved responses
  POST   /engagements/{token}/responses     # Save/autosave
  POST   /engagements/{token}/files         # Upload attachments
  DELETE /engagements/{token}/files/{id}
  POST   /engagements/{token}/submit
```

---

## Authentication & JWT Scoping

### Admin
- bcrypt password verification
- JWT payload: `{ "sub": "admin", "type": "admin" }`
- Stored in localStorage
- All `/api/admin/*` routes validate type == "admin"

### Vendor
- Email verified against `vendor_emails` array on the engagement (case-insensitive)
- JWT payload: `{ "sub": "<email>", "type": "vendor", "engagement_id": "<uuid>" }`
- Stored in sessionStorage
- **Every** `/api/vendor/*` request validates: type == "vendor" AND the engagement_id in the JWT matches the engagement being accessed. This is non-negotiable — check on every request, not just at login.

### IR
- Email verified against `ir_emails` array on the engagement (case-insensitive)
- JWT payload: `{ "sub": "<email>", "type": "ir", "engagement_id": "<uuid>" }`
- Stored in sessionStorage
- Same scoping enforcement as vendor

### Auth failure responses
- Always return generic 401/403 — never indicate which credential was wrong
- Log all auth failures to the audit log

---

## File Upload Security

This application will undergo penetration testing. Follow every rule below without exception.

1. **Magic byte validation before storage** — use `python-magic` for all files; use Pillow additionally for images (`Image.open()` and verify). Reject if magic bytes do not match expected type. Never trust the file extension or Content-Type header alone.
2. **UUID filenames** — generate a UUID4 filename with no extension for storage. Store original filename in DB only.
3. **Store outside web root** — files go to `UPLOAD_DIR` / `IR_UPLOAD_DIR` which are Docker volumes not served by the web server directly.
4. **Serve via authenticated endpoint only** — all file downloads go through `/api/admin/engagements/{id}/files/{file_id}` (or equivalent). The endpoint checks the JWT and verifies the file belongs to an engagement the requester has access to.
5. **No execution permissions** — upload directories must be created with mode 0755 max; never 0777.
6. **Enforce limits server-side** — check per-file size, per-engagement file count, and per-engagement total size on every upload. Return a clear 400 error with the specific limit exceeded.
7. **Validate file count and size limits before writing to disk** — check engagement totals first, reject before touching the filesystem.

---

## Input Sanitization & XSS Prevention

All text input from vendors and IRs must be sanitized server-side before storage.

- Use `bleach` or equivalent to strip HTML tags and dangerous attributes from all text fields
- Apply output encoding when rendering user-supplied content in the frontend (React's JSX handles this by default — never use `dangerouslySetInnerHTML`)
- Sanitize on write (at the API layer via a utility function in `utils/sanitize.py`), not just on read
- This applies to all vendor and IR text inputs: questionnaire responses, file descriptions, service type, free-text fields

---

## Engagement Lifecycle — Status Transition Rules

Enforce these transitions in the backend. Reject invalid transitions with 400.

```
DRAFT
  → FUNCTIONAL_EVALUATION_PENDING     (admin triggers manually via /advance)

FUNCTIONAL_EVALUATION_PENDING
  → PENDING_DISPATCH                  (automatic: when functional evaluation file is uploaded by IR)

PENDING_DISPATCH
  → DD_IN_PROGRESS                    (admin clicks "Dispatch to Vendor")

DD_IN_PROGRESS
  → RISK_ASSESSMENT_PENDING           (automatic: when vendor submits)
  → RISK_ASSESSMENT_PENDING           (admin clicks "Close Questionnaire" — manual close without vendor submission)

RISK_ASSESSMENT_PENDING
  → CLOSED                            (admin finalises risk assessment AND NDA + SOW present)
  → PENDING_CLOSURE                   (admin finalises risk assessment AND NDA or SOW missing)
  → DD_IN_PROGRESS                    (admin clicks "Reopen Questionnaire")

PENDING_CLOSURE
  → CLOSED                            (admin manually clicks "Close Engagement" — requires NDA + SOW present)
  → UNDER_REVIEW                      (admin manually triggers)

CLOSED
  → UNDER_REVIEW                      (admin manually triggers)

UNDER_REVIEW
  → CLOSED or PENDING_CLOSURE         (admin manually closes again — check IR doc status)
```

Vendor form is editable (autosave, file upload/delete) in: `DD_IN_PROGRESS`, `UNDER_REVIEW`.
Vendor form submit button is only available in: `DD_IN_PROGRESS`.
Vendor form is read-only in all other statuses.
IR can upload and delete documents in any status EXCEPT `CLOSED` — once closed, all IR document changes are locked.
Admin can edit structured fields, risk assessment, and internal notes in any status.

---

## Document Number Generation

- On engagement creation, query `MAX(doc_number)` from the engagements table
- Parse the numeric suffix, increment by 1, format as `ABHIT-IST-DD-XXXX`
- If no engagements exist yet, start at the value of `DOC_NUMBER_START` env var (default 1001)
- This is not a database sequence — it is application-level logic
- The field is editable by admin after creation; edits do not affect the sequence

---

## Questionnaire Seeding

On backend startup (after migrations), check if the `questions` table is empty. If empty, load and insert from `app/seed/questions.json`.

Questions 1–30: standard questionnaire  
Questions 31–43: AI addendum (`is_ai_addendum: true`)

The full question list is specified in Section 4.5 of the requirements document. Implement exactly as specified — question numbers, text, and AI addendum flag must match precisely.

Default `response_type` for all questions: `TEXT` unless otherwise noted. Questions 9 and 10 (diagram uploads) should be `FILE_UPLOAD`.

---

## Stub Functions (Phase 3 Scaffolds)

Implement these as stubs now. They must exist, be callable, and return the correct shape — just with placeholder/empty data.

**`services/extraction.py`**
```python
async def extract_structured_fields(engagement_id: str) -> dict:
    """STUB: Phase 3 — Wire to Claude API"""
    return {
        "service_type": None,
        "hosting_location": None,
        "hyperscaler": None,
        "disaster_recovery": None,
        "dr_location": None,
        "data_residency_region": None,
        "encryption_at_rest": None,
        "encryption_in_transit": None,
        "mfa_supported": None,
    }
```

**`services/risk_ai.py`**
```python
async def generate_risk_assessment(engagement_id: str) -> dict:
    """STUB: Phase 3 — Wire to Claude API"""
    return {
        "overall_rating": None,
        "summary": None,
        "risks": [],
    }
```

**`services/notifications.py`**
```python
async def send_vendor_link(engagement_id: str, email: str) -> None:
    """STUB: Phase 3 — Wire to SMTP"""
    pass

async def send_ir_link(engagement_id: str, email: str) -> None:
    """STUB: Phase 3 — Wire to SMTP"""
    pass

async def send_submission_alert(engagement_id: str) -> None:
    """STUB: Phase 3 — Wire to SMTP"""
    pass
```

The `/api/admin/engagements/{id}/extract` and `/api/admin/engagements/{id}/assess-risk` endpoints must exist and call these stubs, returning a 200 with the stub data. The frontend buttons must be present but disabled with tooltips.

---

## Word Export

Implement in `services/export.py` using `python-docx`.

The output must match the existing Albatha DD template:
- **Font**: Dax (fallback: Arial if Dax not available in the environment)
- **Color palette**:
  - Section headings: `#1F3864` (dark navy)
  - Sub-headings: `#2E75B6` (medium blue)
  - Risk Critical: `#EE0000`
  - Risk High: `#C00000`
  - Risk Medium: `#FFC000`
  - Risk Low: `#70AD47`
  - Table header fill: `#1F3864`
  - Table alt row: `#F2F2F2`

**Document sections (in order)**:
1. Cover page — application name, OC names, document number, export date
2. Document Control — version table (v1.0 pre-filled)
3. Executive Summary — placeholder paragraph: "This section will be populated following AI-assisted risk assessment review." (Phase 3 scaffold)
4. Risk Assessment — if risk assessment exists: overall rating badge, summary text, risk register table (description, rating color-coded, assigned to, mitigation). If no risk assessment: empty scaffold table with column headers only.
5. Due Diligence Questionnaire — all questions and responses by section. AI addendum rendered as a clearly labelled separate section. Uploaded images embedded inline using `python-docx` image insertion. PDF attachments noted as "[Attachment: filename.pdf — see uploaded files]".

---

## Database Backup

Implement in `services/backup.py`.

```python
async def create_backup(confirmed_password: str) -> dict:
    # 1. Verify admin password (bcrypt check)
    # 2. Run pg_dump via subprocess to /app/backups/isdd_backup.sql
    # 3. Create tar.gz of backup.sql + all files in UPLOAD_DIR
    # 4. Save as /app/backups/isdd_backup.tar.gz (overwrite previous)
    # 5. Write metadata (timestamp, file size) to /app/backups/backup_meta.json
    # 6. Log to audit log
    # 7. Return { "timestamp": ..., "size_bytes": ... }
```

The download endpoint streams the `.tar.gz` file with appropriate headers. Rate-limit this endpoint (max 5 requests per hour per admin session).

---

## Frontend Routes

```
/due-diligence/admin/login
/due-diligence/admin/dashboard
/due-diligence/admin/engagements/new
/due-diligence/admin/engagements/:id
/due-diligence/admin/settings

/due-diligence/evaluation/:token        # IR portal
/due-diligence/respond/:token           # Vendor portal
```

The React router must use `APP_BASE_PATH` as the basename. Configure via `VITE_BASE_PATH` env var in the frontend build.

Admin routes redirect to login if no valid admin JWT is present in localStorage.
Vendor and IR routes prompt for email verification before showing any content.

---

## Build Phases

### Phase 1 — COMPLETE ✅
- [x] Docker Compose with all three services
- [x] Alembic setup + all DB models
- [x] Question seeding (all 43 questions)
- [x] Admin auth (login/logout, JWT)
- [x] Engagement CRUD (create, list, detail, patch)
- [x] Document number auto-generation
- [x] OC list in settings (CRUD)
- [x] Both token generation (vendor + IR) on engagement creation
- [x] Engagement lifecycle state machine + transitions
- [x] IR portal: email auth, status display, document upload (with all security controls)
- [x] IR document upload triggers automatic DD phase advancement
- [x] Vendor portal: email auth (scoped JWT), questionnaire display, autosave, file upload, submit
- [x] All file upload security controls (magic bytes, UUID filenames, limits, serve via auth endpoint)
- [x] Input sanitization on all vendor and IR text inputs
- [x] Audit logging for all Phase 1 actions
- [x] Stub functions for extraction, risk AI, notifications
- [x] All auth failure responses generic (no leaking)

### Phase 2 — COMPLETE ✅
- [x] Admin engagement dashboard with all columns + filters
- [x] Structured fields panel (all fields, editable, "Extract with AI" button disabled)
- [x] Risk assessment panel (create, draft, edit items, multi-select assignee, finalise, reopen)
- [x] Assignee list in settings (CRUD)
- [x] Engagement can only be Closed with a finalised risk assessment
- [x] Closed — Pending IR Docs state and auto-resolution
- [x] Admin can reopen Closed → Under Review → Closed
- [x] Audit log (system-wide + per-engagement views)
- [x] Word export (python-docx, full template)
- [x] "Generate with AI" button on risk assessment (disabled with tooltip)
- [x] Admin can edit all fields (structured, risk assessment, notes) at any lifecycle stage
- [x] Admin can add/remove vendor and IR emails inline from the engagement detail (EmailEditRow with chip UI, format validation, PATCH endpoint)
- [ ] Database backup (pg_dump + tar.gz + download) — deferred to Phase 3

### Phase 3 — Wire AI + Notifications + Backup
- [ ] Claude API integration for field extraction
- [ ] Claude API integration for risk assessment generation
- [ ] Email notification wiring (SMTP)
- [ ] Database backup: pg_dump via subprocess, tar.gz with uploads, backup metadata JSON, password re-confirmation, rate-limited download endpoint

### Phase 4 — Import
- [ ] JSON import with review-before-save flow
- [ ] AI-powered Word import via Claude API

---

## Security Checklist (Before Any Phase is Considered Done)

- [x] No raw SQL strings anywhere — SQLAlchemy ORM only
- [x] All vendor JWTs scoped to engagement_id, validated on every request
- [x] All IR JWTs scoped to engagement_id, validated on every request
- [x] File magic byte validation implemented and tested
- [x] Files served only via authenticated endpoints
- [x] No file stored with its original filename or executable extension
- [x] XSS sanitization on all vendor/IR text inputs
- [x] Generic error messages on all auth failures
- [x] CORS configured to frontend origin only
- [x] Upload limits (per-file, per-count, per-total) enforced server-side
- [ ] Backup endpoint rate-limited and requires password re-confirmation (Phase 3)
- [x] No secrets in code — all from environment variables

---

## Deployment Notes (Not Implemented in Code)

The application runs under a subpath (`APP_BASE_PATH=/due-diligence`) on `vendorportal.albatha.com`.

**Required WAF rules (configured externally — not in this codebase):**
- `/due-diligence/respond/*` and `/due-diligence/api/vendor/*` → allow all IPs
- `/due-diligence/evaluation/*`, `/due-diligence/admin/*`, `/due-diligence/api/evaluation/*`, `/due-diligence/api/admin/*` → allow ABH corporate IP ranges and VPN egress IPs only; return 403 for all other IPs

**Required server firewall rule:**
- Application server accepts inbound on port 80/443 from WAF IP only

This is a deployment configuration requirement. The application does not implement or enforce these rules — it relies on the WAF doing so. If deploying without a WAF, these routes will be publicly accessible, which is a critical security misconfiguration.
