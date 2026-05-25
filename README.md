# ISDD Portal

Information Security Due Diligence portal for ABH IT. Replaces the email-based vendor questionnaire process with a containerised web application used by three distinct user types: the Information Security Team (admin), IT Representatives (IR), and external vendors.

---

## Features

### Admin Portal

**Engagement management**
- Create engagements for applications undergoing due diligence. Each engagement gets an auto-generated document number (`ABHIT-IST-DD-XXXX`), unique vendor and IR access tokens, and can be tagged to one or more Operating Companies.
- The default landing page after login is **Engagements** at `/admin/engagements`.
- **Engagements** tab (left sidebar) — search-by-name, status filter, OC filter, date-range filter (with `Created date` / `Submitted date` selector), and a paginated table. Always rendered as **grouped-by-family**: each row represents one engagement family (the latest revision), with a chevron that expands to show every prior revision as sub-rows in **descending revision order** (R{N-1}, …, R0 below the latest parent) — sub-row order is always descending regardless of the top-level sort direction. The parent row's status reflects the latest revision. The DOCUMENT # column header is sortable in either direction (default descending — biggest DD number on top), with a small caret indicator; sort direction is component state only and is not persisted across sessions. All other column headers are non-interactive labels. The doc-number cell strips any `-R{n}` suffix; the R-chip on each row is the revision differentiator. Cancelled revisions are rendered muted in the expanded sub-rows. A **Clear filters** action appears when any filter is active; sort direction is unaffected. Filter and sort state are not persisted across sessions.
- **Dashboard** tab (left sidebar, at `/admin/dashboard`) — an inventory-style view with one row per engagement family. Each row uses the **latest non-cancelled revision** for application name, OCs, status, AI flag, revision label, and structured-fields columns (service type, hosting, hyperscaler, DR, DR location, data residency, encryption at rest, encryption in transit, MFA); families where every revision is cancelled fall back to their latest cancelled revision and are rendered in muted text on every cell except the status pill, which keeps its `CANCELLED` colour. Sort is locked to root document number descending; no filters, search, or column toggles in v1. The DOCUMENT # column is hyperlinked (click-through to the engagement detail page). The table scrolls horizontally only when its natural width exceeds the container. Null structured-fields values render as em-dashes. The Engagements list and the Dashboard are independent views; the Engagements list moved from `/admin/dashboard` to `/admin/engagements` when this view was introduced.
- Inline editing of engagement metadata including application name, OC associations, vendor/IR email lists, and internal notes.

**Lifecycle state machine**
The engagement moves through a defined set of statuses, with transitions enforced server-side:

```
DRAFT
  → FUNCTIONAL_EVALUATION_PENDING    (admin triggers manually — new engagements only)
  → DD_IN_PROGRESS                   (refresh engagements only — admin clicks "Dispatch to Vendor")
  → PENDING_DISPATCH                 (automatic: IR uploads functional evaluation)
  → DD_IN_PROGRESS                   (admin clicks "Dispatch to Vendor")
  → RISK_ASSESSMENT_PENDING          (automatic: vendor submits, or admin clicks "Close Questionnaire")
  → CLOSED / PENDING_CLOSURE         (admin finalises risk assessment)
  → UNDER_REVIEW                     (admin manually reopens closed engagement)

ANY STATUS → CANCELLED               (admin — requires password re-confirmation)
CANCELLED  → DRAFT                   (admin reopens — yes/no confirmation)
```

`PENDING_DISPATCH` indicates the functional evaluation has been received and the vendor questionnaire is ready to go — the admin explicitly dispatches it rather than the link going live automatically.

`DD_IN_PROGRESS` covers the full active questionnaire window, from dispatch through to vendor submission. Admin can also close the questionnaire manually ("Close Questionnaire" button) to advance without waiting for vendor submission. The IR portal shows a read-only Vendor Responses tab once this status is reached.

`PENDING_CLOSURE` means the risk assessment has been finalised but NDA or SOW documents are still missing. The admin manually clicks **Close Engagement** once both documents are in place — this is enforced server-side and will return an error naming any missing documents. IR document uploads and deletes are permitted in this state. Once the engagement reaches `CLOSED`, the IR portal locks all document changes — the admin must move to `UNDER_REVIEW` first to re-enable them.

For **refresh engagements** (revision_number > 0), the NDA / SOW close check walks the engagement family — coverage from any earlier revision (typically R0) satisfies the requirement, so a refresh with no fresh IR uploads can still close cleanly.

`CANCELLED` can be set from any point in the lifecycle. It requires the admin to re-enter their password. A cancelled engagement can be reopened to `DRAFT` with a simple yes/no confirmation. Cancelled revisions are skipped when computing the family's "latest" revision (so cancelling R1 in a `[R0 CLOSED, R1]` family makes R0 the latest again, with the Refresh button re-enabled), and the next refresh always uses `MAX(revision_number) + 1` across the entire family — a cancelled R1 keeps its slot, the next refresh becomes R2, never R1.

**Engagement Details panel**
Vendor and IR email lists are editable inline — click Edit next to either field to enter edit mode. Add emails one at a time (Enter or Add button, with format validation and duplicate detection); remove individual emails via the chip × button; Save commits via `PATCH /api/admin/engagements/{id}`.

For multi-revision families (revision_count > 1), the panel also surfaces:
- **Last refresh** row — keyed on the latest revision after R0: shows `closed_at` for closed revisions, `cancelled_at` for cancelled, `created_at` with " — in progress" suffix for in-flight revisions. Format: `28 Apr 2026 (R2)` or `28 Apr 2026 (R2 — in progress)`.
- **Revisions** block — a vertical stack of every revision in the family (latest first), each line showing the revision number, a status-driven label (e.g. "closed Apr 2026", "cancelled Apr 2026", "in progress"), and inline tags: `(current)` on the latest non-cancelled, `(original)` on R0. Cancelled rows are rendered in muted text.

Single-revision engagements render none of these — the Overview looks unchanged for normal engagements.

**Header redirect to latest revision**
Opening any non-latest revision's URL (e.g. clicking R0 from a dashboard sub-row) immediately client-side replaces the URL with the family's latest revision and renders that revision's data. This keeps the page authoritative — admins always see the live state of the family. A small muted indicator next to the status badge reads `Revision R{N} · {N+1} of {total}` whenever the family has more than one revision.

**Structured fields panel**
Nine key technical fields extracted from the questionnaire responses (service type, hosting location, hyperscaler, DR location, data residency, encryption at rest/in transit, MFA support). All editable by admin at any lifecycle stage. "Extract with AI" button is present and will be wired to the Claude API in Phase 3.

**Risk assessment panel**
- Create a draft risk assessment on any engagement.
- Add, edit, and reorder risk items: each has a description, risk rating (Critical/High/Medium/Low), one or more assignees (drawn from the configurable assignee list), and a mitigation note.
- Set an overall risk rating and free-text summary.
- Finalise the assessment — this triggers the engagement to advance from `RISK_ASSESSMENT_PENDING` to `CLOSED` (if both NDA and SOW are present) or `PENDING_CLOSURE` (if either is missing).
- Reopen a finalised assessment to DRAFT for revision.
- Engagements cannot be manually set to CLOSED without a finalised risk assessment.
- "Generate with AI" button is present and will be wired to the Claude API in Phase 3.

**Engagement Refresh (R1 / R2 / …)**
Once an engagement is `CLOSED` or `UNDER_REVIEW`, the admin can create a new revision of it via the **Refresh Assessment** button. The button is only visible when the current view is the latest revision in its family.

- A confirmation modal requires admin password re-entry.
- The new engagement gets a `-R{n}` doc number suffix (e.g. `ABHIT-IST-DD-1001-R1`), fresh vendor and IR tokens, and is pinned to the **current published** questionnaire version (not the source's version).
- Responses are pre-filled from the source by matching `question_key` across versions; if the response type changed, the response is treated as unmatched and not copied.
- Refresh engagements skip the FE phase entirely. The lifecycle is `DRAFT → DD_IN_PROGRESS → RISK_ASSESSMENT_PENDING → PENDING_CLOSURE → CLOSED`. The DRAFT screen shows a single **Dispatch to Vendor** button rather than "Advance to IR Stage".
- IR can still upload documents during a refresh via their token (e.g. NDA renewal, SOW addendum), but uploads do **not** advance the lifecycle.
- Each revision has its own risk assessment, its own response set, and its own export — but files are unified across the family (see below).

**Cancel Engagement**
Any engagement can be cancelled from any lifecycle stage. The "Cancel Engagement" button (in red) sits between the Engagement Details and Structured Fields panels on the Overview tab. Clicking it opens a password confirmation modal — the admin must re-enter their password before the cancellation proceeds. The action is audit-logged. A cancelled engagement shows a "Reopen DD" button in the same position; clicking it (yes/no confirmation, no password) returns the engagement to `DRAFT` so it can progress through the lifecycle again.

**File management**
The Files tab shows **all files across the engagement family** in a single unified list — IR documents and vendor attachments from R0 alongside anything uploaded during R1, R2, etc. Each row carries a revision badge (R0, R1, …) so the source revision is always visible. Default sort is upload date descending.

- **Download** is enabled on every file in the family — admin can pull down R0's NDA from R1's URL just as easily as an R1-uploaded attachment.
- **Delete** is gated to the latest revision only. Files belonging to prior revisions render with a disabled Delete button and a "Cannot delete files from a previous revision" tooltip; the backend independently rejects the call with 403 if anyone tries.
- Deletion still requires admin password re-confirmation and is permanent + audit-logged.

**Responses view**
Read-only view of all vendor questionnaire answers, rendered from the engagement's pinned questionnaire version (so historical engagements show their original structure even after the questionnaire has changed). The version label is shown above the answer list. File upload questions show download links. All files are served through an authenticated endpoint — never directly from disk.

For multi-revision families, a **revision dropdown** in the top-right of the Responses tab lets the admin switch between R0, R1, R2, etc. The selector defaults to the current revision; selecting a different one swaps the rendered tab content to that revision's pinned questionnaire version and its responses. When viewing anything other than the latest, a yellow strip above the questions reads "Viewing historical responses from R{N} ({state}). These are read-only." with a "Back to latest" link. Cancelled revisions appear in the dropdown muted with `(cancelled)`. The vendor and IR portals never expose this dropdown — they only ever see the revision tied to their token.

**Audit log**
Every action in the system is recorded: auth events, status transitions, file uploads/deletes, field edits, submissions. Viewable per-engagement and system-wide, with actor, action key, human-readable description, and JSONB metadata.

**Word export**
Generates a `.docx` file matching the Albatha DD template:
- Cover page (application name, OCs, document number including any `-R{n}` revision suffix, export date)
- Document Control table plus an engagement-metadata table showing the document number and the **Questionnaire Version** the engagement is pinned to
- Executive Summary (Phase 3 scaffold)
- Risk Assessment section (overall rating, summary, colour-coded risk register table)
- Full questionnaire rendered from the engagement's pinned version's sections; AI addendum on a separate page when the engagement is AI-flagged; images embedded inline; PDFs noted with filename. Choice answers using `allows_other` render as `Other — {text}` (or just `Other` when no text was supplied)
- **Supporting Documents** section listing every file uploaded on or before this revision (this revision plus all ancestor revisions in the family) with a `Revision` column tagging each file as `R0`, `R1`, etc. — so the reader can identify which assessment cycle each document belongs to.

For multi-revision families, the **Export Word** button has a chevron dropdown listing every revision in the family. The plain button exports the current (latest) revision; selecting a sibling from the dropdown produces that revision's complete point-in-time snapshot — its pinned questionnaire version, its responses only (no carry-over from later revisions), its risk assessment, and family files up to that revision's closure. Cancelled revisions appear in the dropdown muted.

**Settings**
- Operating Companies list — add/edit/delete; used on the New Engagement form and appears in exports.
- Assignees list — name + type label (e.g. "Vendor", "ABH IT"); used in the risk assessment assignee selector.

**Questionnaire editor**
A versioned editor at `/due-diligence/admin/questionnaire` for configuring the security questionnaire that vendors complete.

- Three-column layout: sections list (with Standard / AI Addendum tabs), questions within the selected section, and a metadata panel with publish/discard controls.
- Edit questions inline: text, response type (Text / Single choice / Multi choice / File upload), required flag, hint text, options for choice types, and an "Allow 'Other' response" toggle that auto-renders an "Other (please specify)" option in the vendor form.
- All edits live in client state until the admin clicks **Save draft** — the entire draft is reconciled against the database in one transaction, with a single audit-log entry summarising counts of created/edited/deleted entities.
- "Preview as vendor" opens the draft in a read-only vendor view at `/due-diligence/admin/questionnaire/preview`.
- **Publish** opens a diff view (added/removed/edited questions matched on stable `question_key`), requires a changelog (min 20 chars) and password re-confirmation, optionally accepts a version label override (regex `v\d+\.\d+`), and atomically: renumbers the draft, flips the previous current to archived, promotes the draft to current, and clones a fresh draft from it.
- **Discard draft** wipes the current draft and re-clones from the published version.
- Version history is queryable and immutable — published versions are never edited or deleted.

**Engagement → questionnaire version pinning**
Each engagement is pinned to the questionnaire version that was current at creation time. Publishing a new version does not retroactively change in-flight or closed engagements: vendors, IRs, the admin Responses tab, and Word exports all render the engagement's pinned version's structure, even if the current draft has changed wildly. This guarantees the export is a faithful snapshot of what the vendor attested to at the time.

---

### IT Representative (IR) Portal

Accessed at `/due-diligence/evaluation/:token` — the token is generated when the engagement is created and is sent to IR email addresses.

- Email verification gate: IR enters their email, which is checked against the `ir_emails` list on the engagement.
- Upload three categories of documents: Functional Evaluation, NDA, SOW.
- Uploading a Functional Evaluation automatically advances the engagement from `FUNCTIONAL_EVALUATION_PENDING` to `PENDING_DISPATCH`. The admin must then explicitly click **Dispatch to Vendor** to issue the questionnaire link.
- The Functional Evaluation cannot be deleted once the questionnaire has been dispatched (`DD_IN_PROGRESS` or later). It can be replaced before dispatch if the wrong file was uploaded.
- Document uploads and deletes are permitted in `PENDING_CLOSURE`. Once the admin clicks **Close Engagement**, the IR portal locks — no further changes until the admin moves the engagement to `UNDER_REVIEW`.
- During a **refresh** (R1, R2, …) the IR can upload renewed documents (FE refresh, NDA renewal, SOW addendum) at any point in the refresh's active lifecycle. Refresh uploads do not auto-advance the engagement. The IR sees all family files in their portal (downloadable, badged with the source revision) but can only delete files they uploaded against the current revision.
- Two-tab layout: **Pre-DD Documents** (upload) and **Vendor Responses** (read-only, visible from `DD_IN_PROGRESS` onwards). The Vendor Responses tab renders the engagement's pinned questionnaire version's full structure (including unanswered questions), labelled with the version (e.g. `v1.0`), and shows answers — including `Other — …` for choice-with-other responses — with last-updated timestamps.
- Dark mode toggle; status badge in header.

---

### Vendor Portal

Accessed at `/due-diligence/respond/:token` — the token is generated when the engagement is created and is sent to vendor email addresses.

- Email verification gate: vendor enters their email, checked against `vendor_emails`. JWT is scoped to this specific engagement and validated on every request.
- Renders the engagement's pinned questionnaire version: sections, questions, and options are loaded from that version regardless of whether a newer version has since been published. The seeded `v1.0` version has 43 questions across 12 sections (standard + AI addendum, the latter shown only when the engagement is flagged as an AI application).
- Question response types: TEXT (textarea), SINGLE_CHOICE (radio), MULTI_CHOICE (checkbox), FILE_UPLOAD (drag-and-drop with per-file and total size limits enforced server-side). Choice questions with `allows_other=true` render an extra "Other (please specify)" option that expands a text field on selection — saved as the sentinel `__other__` in `selected_options` plus the text in `other_text`.
- **Save draft** button in the sticky header — responses are saved manually on demand rather than automatically. Reloading the page restores the last saved state, so vendors can discard unwanted changes by refreshing.
- Server-side validation rejects any save whose `question_id` doesn't belong to the engagement's pinned version (400).
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
2. Run `alembic upgrade head` — migration `0004_questionnaire_versioning` creates the `questionnaire_versions` / `questionnaire_sections` / `question_options` tables, seeds the initial published `v1.0` version with all 43 questions across 12 sections, pins any pre-existing engagements to `v1.0`, and clones a starter draft so the admin questionnaire editor is usable from day one. Migration `0005` adds the `previous_question_key` column for refresh-matching across response-type changes. Migration `0006` adds `closed_at` / `cancelled_at` columns on engagements (with a backfill that walks the audit log) so revision pickers can display precise terminal timestamps.
3. Start uvicorn

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
6. From the engagement detail page, click **Advance to IR Stage** to move to `FUNCTIONAL_EVALUATION_PENDING` and share the IR token link with the IR team. (For an existing CLOSED engagement, click **Refresh Assessment** instead to start a new R1 — the refresh skips IR Stage and the DRAFT view shows a single **Dispatch to Vendor** button.)

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
| Phase Q1 — Questionnaire versioning schema + Alembic migration & backfill | Complete |
| Phase Q2 — Admin questionnaire editor (read-only) | Complete |
| Phase Q3 — Admin questionnaire editor (write, batched save) | Complete |
| Phase Q4 — Publish flow, draft diff, version history | Complete |
| Phase Q5 — Version-aware vendor / IR / admin / export rendering | Complete |
| Phase Q6 — Engagement refresh (R1/R2) flow | Complete |
| Phase Q7 — Dashboard grouping, revision-aware UI, refresh lifecycle, family file unification | Complete |
| Phase 3 — Claude AI integration, email notifications, database backup | Not started |
| Phase 4 — JSON/Word import | Not started |
