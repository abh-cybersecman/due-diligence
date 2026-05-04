# ISDD Portal — Questionnaire Versioning & Engagement Refresh

This document is an **addendum to CLAUDE.md** covering two linked features:

1. **Admin-managed questionnaire** — admin can configure sections, questions, response types, and dropdown options through a UI. Versioned.
2. **Engagement refresh** — an existing engagement (e.g. `ABHIT-IST-DD-1001`) can be refreshed into a revision (`ABHIT-IST-DD-1001-R1`) that may use a newer questionnaire version.

Read this file in full before making any changes. Where this document and CLAUDE.md disagree, **this document wins** for anything related to questionnaire structure, engagement revisions, or response rendering.

---

## Two Design Axioms (Non-Negotiable)

### Axiom 1 — Published questionnaire versions are immutable

Once a questionnaire version is published, its sections, questions, options, and response types are frozen. You do not alter a published version in place. New changes go into a draft, which becomes a new version on publish.

The only exception is **text-only edits** (question text, section title, hint text) to fix typos and clarify wording. These are applied in place and recorded in the audit log. They do **not** change response shape, options, or required-ness. No separate UI surface — just the audit trail.

### Axiom 2 — Reopen ≠ Refresh

Two distinct operations, two distinct data flows:

- **Reopen** — same engagement, same questionnaire version, existing responses carried, vendor edits and resubmits. Lifecycle transition only. Already implemented (`/reopen`, `/close-questionnaire`).
- **Refresh** — creates a new engagement row with a revision number (`R1`, `R2`, …), linked to the original. May use a newer questionnaire version. Pre-fills answers from the previous revision where the same question persists. Gets its own risk assessment, its own files, its own lifecycle, its own export.

A refresh never mutates the predecessor. The predecessor remains a sealed record of what was attested to at that time.

---

## Schema Changes

### New tables

**`questionnaire_versions`**
- `id` (UUID PK)
- `version_label` (String, unique — e.g. `"v1.0"`, `"v2.1"`)
- `is_current` (Boolean — exactly one row with `true` among published rows)
- `is_draft` (Boolean — exactly one row with `true` at any time)
- `published_at` (DateTime UTC, nullable — null while draft)
- `changelog` (Text, nullable — required on publish)
- `created_at`, `updated_at` (DateTime UTC)

Enforce invariants via partial unique indexes:
```sql
CREATE UNIQUE INDEX only_one_draft ON questionnaire_versions (is_draft) WHERE is_draft = true;
CREATE UNIQUE INDEX only_one_current ON questionnaire_versions (is_current) WHERE is_current = true;
```

**`questionnaire_sections`**
- `id` (UUID PK)
- `version_id` (UUID FK → `questionnaire_versions`, cascade delete)
- `title` (String)
- `order` (Integer)
- `is_ai_addendum` (Boolean — replaces the per-question flag; a section is either standard or AI addendum)

**`question_options`**
- `id` (UUID PK)
- `question_id` (UUID FK → `questions`, cascade delete)
- `label` (String)
- `order` (Integer)

### Modified tables

**`questions`** — existing table, modified:
- Add `version_id` (UUID FK → `questionnaire_versions`, cascade delete)
- Add `section_id` (UUID FK → `questionnaire_sections`, cascade delete) — replaces the `section` String column
- Add `question_key` (String) — stable identifier across versions; format `q_<slug>` or `q_<uuid>`; editable only at creation of a net-new question
- Add `allows_other` (Boolean, default false) — only meaningful when `response_type IN (SINGLE_CHOICE, MULTI_CHOICE)`
- Add `hint_text` (Text, nullable) — optional helper shown below the question
- **Remove** `section` (replaced by `section_id`)
- **Remove** `is_ai_addendum` (moved to section)
- **Change** `question_number`: drop global unique, add composite unique `(version_id, question_number)`
- Keep `response_type`, `is_required`, `question_text`, `order`

**`engagements`** — existing table, modified:
- Add `questionnaire_version_id` (UUID FK → `questionnaire_versions`, NOT NULL) — pinned at engagement creation
- Add `parent_engagement_id` (UUID FK → `engagements`, nullable) — NULL for originals, set for R1+
- Add `revision_number` (Integer, default 0) — 0 for originals, 1+ for refreshes

`doc_number` now encodes revision: originals are `ABHIT-IST-DD-1001`, refreshes are `ABHIT-IST-DD-1001-R1`, `ABHIT-IST-DD-1001-R2`, etc.

**`responses`** — existing table, modified:
- Add `other_text` (Text, nullable) — populated when `__other__` is among `selected_options` for a question with `allows_other=true`
- No change to `question_id` FK — since `questions` rows are now version-scoped, response→question linkage is automatically version-correct

### Tables with no changes

`file_uploads`, `risk_assessments`, `risk_items`, `structured_fields`, `audit_logs`, `operating_companies`, `assignees` — unchanged.

---

## Alembic Migration Plan

One migration, `0004_questionnaire_versioning.py`. Run order:

1. **Create `questionnaire_versions`** and insert a single row for `v1.0` with `is_current=true`, `is_draft=false`, `published_at=now()`, `changelog="Initial seed"`.
2. **Create `questionnaire_sections`**. Insert one row per distinct `section` string currently in `questions`, all with `version_id=v1.0.id`. Compute `is_ai_addendum` per section by checking whether any question in it has `is_ai_addendum=true` (current seed: all questions in a section share the flag, so this is safe; if a section has a mix, fail the migration with a clear error).
3. **Alter `questions`**:
    - Add `version_id`, `section_id`, `question_key`, `allows_other`, `hint_text` columns.
    - Backfill `version_id = v1.0.id` for every row.
    - Backfill `section_id` by looking up the matching section title within v1.0.
    - Backfill `question_key` as `q_{question_number}` (e.g. `q_1`, `q_23`).
    - Backfill `allows_other=false`.
    - Drop old `section` column.
    - Drop old `is_ai_addendum` column.
    - Drop old unique index on `question_number`; add composite unique on `(version_id, question_number)`.
    - Set `version_id` and `section_id` to NOT NULL.
4. **Create `question_options`**. No data to backfill — current questions are all TEXT or FILE_UPLOAD.
5. **Alter `engagements`**:
    - Add `questionnaire_version_id` (nullable initially), `parent_engagement_id`, `revision_number` (default 0).
    - Backfill `questionnaire_version_id = v1.0.id` for all existing rows.
    - Set `questionnaire_version_id` to NOT NULL.
6. **Alter `responses`**: add `other_text` column (nullable).
7. **Clone v1.0 into a draft**. After all structural migration is done, create a second `questionnaire_versions` row (`v1.1` or similar `version_label`, `is_draft=true`, `is_current=false`, `published_at=null`, `changelog=null`), copy all sections/questions/options into it with fresh UUIDs but identical `question_key` values. This gives the admin a draft to start editing from day one.

The seeding logic in `main.py` (`lifespan` event) must be updated to skip its current behaviour if `questionnaire_versions` already has rows; it is now a no-op after initial migration.

---

## Version Lifecycle

### States

| State | `is_draft` | `is_current` | `published_at` | Usable by engagements? |
|---|---|---|---|---|
| Draft (being edited) | true | false | null | No |
| Current published | false | true | set | Yes (default for new engagements) |
| Archived published | false | false | set | Yes (existing engagements still reference) |

### Operations

**Create draft** — automatic. Whenever there is no draft row (immediately after a publish), the system clones the current published version into a new draft. Admin never creates drafts manually; they are always present.

**Edit draft** — admin can freely add/remove/reorder sections and questions, change response types, add options, etc. The draft is not visible to any engagement. Autosave is fine, but a "Preview as vendor" view is essential.

**Publish draft** — admin clicks Publish, enters a required changelog note (min 20 chars) and re-confirms password. In a single transaction:
1. Call `renumber_version(draft_id)` (`app/services/questionnaire.py`) so `question_number` is gap-free and reflects display order on the frozen version.
2. Current published version's `is_current` flips to `false`.
3. Draft's `is_draft` flips to `false`, `is_current` flips to `true`, `published_at` stamped, changelog saved.
4. A new draft is cloned from the just-published version.
5. Audit log entry: `questionnaire.published` with metadata `{from_version: "v2.0", to_version: "v2.1", changelog: "..."}`.

Question numbers are not kept in sync with display order during draft editing (reorders only touch `order`). The renumber step on publish — and the "Renumber questions" admin action on the draft editor — are the only times `question_number` is rewritten.

**Discard draft** — admin can wipe the draft and re-clone from current published. Requires yes/no confirmation. Audit-logged.

**No delete for published versions.** Ever. They may be archived (not current) but remain queryable forever.

### Version labelling

- Initial seed: `v1.0`.
- Each publish auto-increments the minor version: `v1.1`, `v1.2`, …
- Admin can override the label at publish time (e.g. bump to `v2.0` for a major rework). Must be unique. Must match regex `^v\d+\.\d+$`.

---

## Question Editor UI — Admin

New route: `/due-diligence/admin/questionnaire`.

### Layout

Three-column layout:

- **Left column** (240px fixed) — Sections list. Each row shows section title + question count. Drag to reorder. "+ Add Section" button at the bottom. Active section highlighted. Two tabs above the list: "Standard" / "AI Addendum".
- **Middle column** (flex) — Questions within the selected section. Each row is a collapsed card showing question number, truncated text, response type badge, and required/optional pill. Click to expand for inline editing. Drag handle to reorder within the section. "+ Add Question" button at the bottom.
- **Right column** (360px fixed) — Metadata panel: current draft version label, "Last edited" timestamp, "Preview as vendor" button, "Discard draft" button, and a prominent "Publish" button at the bottom.

### Question edit form (inline expansion)

Fields:
- Question text (textarea, required)
- Response type (dropdown: Text / Single choice / Multi choice / File upload)
- Required (checkbox)
- Hint text (optional textarea)
- **If Single/Multi choice:**
    - Options list with drag-to-reorder; each option has a text input and delete button; "+ Add option" button
    - "Allow 'Other' response" checkbox — when checked, the vendor form will auto-render an "Other (please specify)" option at the bottom that expands a text field when selected. Admin does not add this option manually.

### Section edit

Click section title in left column → inline rename. Dropdown next to title: Delete section (confirm if non-empty — warns about question loss). Toggle: is AI addendum.

### Publish flow

Clicking Publish opens a modal:
- Shows a **diff view**: for each `question_key`, one of `UNCHANGED` / `EDITED` / `ADDED` / `REMOVED`, with old→new text shown for EDITED.
- Required changelog textarea (min 20 chars).
- Admin password field (bcrypt verified).
- Optional version label override.
- Confirm/Cancel.

### Preview as vendor

Opens the vendor questionnaire UI in a new tab, rendering the current draft (not a real engagement). Read-only — no save, no submit. URL pattern: `/due-diligence/admin/questionnaire/preview`.

### New `question_key` rules

- When admin clicks "+ Add Question", a new key is generated: `q_<8-char-slug>`. Shown as read-only metadata on the expanded card.
- When admin edits an existing question's text, `question_key` stays.
- When admin changes an existing question's `response_type`, warn that this creates a new question for refresh-matching purposes, and **force a new key**. (Reasoning: a question that used to be TEXT is semantically different from the same-worded question that is now SINGLE_CHOICE. Matching them on refresh would be wrong.)
- `question_key` is never user-editable directly.

---

## Vendor & IR Questionnaire Rendering

Vendor form and IR read-only view must render the questionnaire **of the engagement's pinned version**, not the current published version.

- `GET /api/vendor/engagements/{token}` — payload includes the version_id and the sections + questions + options for that version.
- Same for `GET /api/evaluation/engagements/{token}/responses`.
- Same for admin's Responses tab on an engagement detail page.

### `allows_other` rendering

For Single/Multi choice questions with `allows_other=true`:
- Frontend auto-appends "Other (please specify)" to the options list.
- When selected, a text input appears below the options.
- On save: `selected_options` includes the sentinel string `"__other__"` and `other_text` holds the typed text.
- On render: if `__other__` is in `selected_options`, show "Other" checked/selected plus the text from `other_text`.

Sanitize `other_text` with `bleach` on write, same as all other free-text fields.

---

## Engagement Refresh — The R1/R2 Flow

### Endpoint

`POST /api/admin/engagements/{id}/refresh`

Preconditions:
- Source engagement must be in `CLOSED` or `UNDER_REVIEW` status. Reject with 400 otherwise.
- Admin password re-confirmation required (same modal pattern as cancel).

What it does (single transaction):

1. Look up the **highest existing revision** for this engagement family. An "engagement family" is defined by the root engagement — find it by walking `parent_engagement_id` up until `NULL`. All rows where the root is the same form the family. Let `next_rev = max(revision_number in family) + 1`.
2. Create a new engagement row with:
    - `doc_number` = `{root_doc_number}-R{next_rev}` (e.g. if root is `ABHIT-IST-DD-1001`, the new row is `ABHIT-IST-DD-1001-R1`).
    - `parent_engagement_id` = the source engagement's id.
    - `revision_number` = `next_rev`.
    - `questionnaire_version_id` = current published version (not source's version).
    - `application_name`, `operating_companies`, `vendor_emails`, `ir_emails`, `is_ai_application` — copied from source.
    - `internal_notes` — empty.
    - `status` = `DRAFT`.
    - New `vendor_token` and `ir_token` UUIDs.
3. **Pre-fill responses**. For each question in the new version, look up the source engagement's response where `source_question.question_key == new_question.question_key`:
    - If match found and response exists: create a response row on the new engagement with `response_text`, `selected_options`, `other_text` copied from source. If the new question's `response_type` differs from source's, **do not copy** — treat as unmatched.
    - If match found but source response is empty: skip, no row created.
    - If no match (new question, removed question): nothing to do.
4. Audit log entry: `engagement.refreshed` with metadata `{source_doc_number, source_version, new_version, carried_response_count, new_question_count, removed_question_count}`.
5. Return the new engagement. Frontend navigates to its detail page.

The new engagement skips the FE phase. Its lifecycle is: DRAFT → DD_IN_PROGRESS → RISK_ASSESSMENT_PENDING → PENDING_CLOSURE → CLOSED. Admin dispatches directly to the vendor from DRAFT via `/dispatch`. IR can upload documents during the refresh via their token at any time, but uploads do not advance the lifecycle.

NDA/SOW close validation for refreshes walks the family — coverage from any earlier revision (typically R0) satisfies the requirement, so a refresh with no IR uploads can still close cleanly.

### "Carried over" indicator

Pre-filled responses are visible to the vendor but shown with a subtle indicator (`Carried over from ABHIT-IST-DD-1001 — please review`). Once the vendor edits a carried-over response, the indicator is removed for that question and `updated_at` on the response is refreshed.

Store this as a transient flag computed at render time, not persisted — compare the response's `updated_at` against the engagement's `created_at`. If equal (within 1 second), it's a carried-over response untouched by the vendor.

### Cancellation safety

If the admin cancels a refresh engagement (R1), the source (R0) is unaffected. Cancelling or deleting a non-latest revision in a family is allowed and has no cascading effect. The family lineage stays intact via `parent_engagement_id`.

---

## Dashboard & Responses Tab Behaviour

### Admin dashboard

Default view: **grouped by engagement family**. Each row represents the root engagement (R0) and shows the latest revision's status.

- Document number cell: `ABHIT-IST-DD-1001 · R2` with a small chevron.
- Clicking the chevron expands to show R1 and R0 as sub-rows beneath, each with their own status and links.
- Status column of the parent row shows the latest revision's status.
- Grouped-by-family is the only view; there is no flat-row toggle.
- Status filter and search apply across revisions.

### Engagement Detail page — Refresh button

Visible when the engagement is `CLOSED` or `UNDER_REVIEW` and this engagement is the **latest revision in its family**. Label: "Refresh Assessment". Opens a confirmation modal with admin password re-entry.

If the current engagement is not the latest revision (user opened an older R), the Refresh button is hidden and a banner at the top of the page reads: `This is revision R1 of ABHIT-IST-DD-1001. The latest revision is R2 — [view latest]`.

### Engagement Detail page — Responses tab

Top-right of the Responses tab: a dropdown selector.

- Label: `Showing responses from: R2 (current) ▾`
- Options: every revision in the family, most recent first. Format: `R2 (current) — submitted Apr 2026`, `R1 — submitted Oct 2024`, `Original — submitted Feb 2023`.
- Switching the dropdown re-renders the entire tab with the selected revision's **questionnaire version** and **responses**. Question structure mirrors that revision's pinned version, not the current version.
- When viewing anything other than the latest revision, show a yellow strip above the questions: `Viewing historical responses from R1. These are read-only. [Back to latest]`.
- This selector is admin-only; the vendor and IR portals always show the revision tied to their token.

---

## Export Behaviour

Word export generation changes:

1. **Cover page** — include the revision suffix in the document number (e.g. `ABHIT-IST-DD-1001-R1`). If the engagement is a refresh, add a line to the cover metadata table: `Refresh of | ABHIT-IST-DD-1001 (original assessment dated Feb 2023)`.
2. **Document Control** — the version table's `Questionnaire Version` field must show the engagement's pinned version label (e.g. `v2.1`). Add this as a new metadata row if not already present.
3. **Questionnaire section** — renders exactly the sections and questions of the engagement's pinned version. Does not attempt to show current version's extra questions or highlight diffs. The export is a faithful snapshot of what the vendor attested to at the time.
4. The `allows_other` behaviour renders as: option label "Other — {other_text}" when selected, or just "Other" if selected without text.

---

## API Routes (Admin)

New routes, all under `/api/admin/`:

```
GET    /questionnaire/versions                      # list all versions
GET    /questionnaire/versions/{id}                 # full version: sections + questions + options
GET    /questionnaire/draft                         # shortcut for the current draft
POST   /questionnaire/draft/save                    # batched save: body is the full draft state; backend reconciles (creates/edits/deletes sections, questions, options) in a single transaction
POST   /questionnaire/draft/renumber                # reassign question_number = 1..N across the draft
POST   /questionnaire/draft/publish                 # publish draft → new current version (password required; also renumbers)
POST   /questionnaire/draft/discard                 # wipe and re-clone from current (yes/no confirm)
GET    /questionnaire/draft/diff                    # returns diff vs current published version
GET    /questionnaire/preview                       # public version of draft for preview
POST   /engagements/{id}/refresh                    # create R1/R2 (password required)
```

The admin editor uses a single batched save rather than per-mutation endpoints.
Every local edit (text, response type, option add/remove/reorder, required /
allows-other toggles, hint text, section rename, ai-addendum toggle,
create/delete, drag-reorder of sections and questions) stays client-side until
the admin clicks **Save draft**. The payload contains the entire draft state;
the backend diffs it against the DB and applies the minimum set of changes
atomically. One `questionnaire.draft.saved` audit log entry covers the whole
batch with a summary of counts per entity type.

Vendor and IR endpoints are **unchanged in path** but their payloads now include version metadata.

All questionnaire editor endpoints reject writes when the target is not the draft. Returns 400 with message `"Only the draft version can be edited"`.

All questionnaire mutations write audit entries with `action = questionnaire.draft.section.created` / `questionnaire.draft.question.edited` / etc.

---

## Build Phases

This feature is large. Implement in sequence. Each phase must build clean (`docker compose up --build`) and pass manual smoke test before the next.

### Phase Q1 — Schema migration + data backfill

- Create `questionnaire_versions`, `questionnaire_sections`, `question_options` tables.
- Modify `questions`, `engagements`, `responses` per spec.
- Write Alembic migration `0004_questionnaire_versioning.py` that does the full backfill.
- Remove question seeding from `lifespan` in `main.py` — migrations are now the source of truth.
- SQLAlchemy models updated. Pydantic schemas for the new shape.
- No UI yet. No new endpoints yet.
- Verify: existing `docker compose down -v && docker compose up --build` results in one published version (`v1.0`) with all 43 questions in their sections, one draft cloned from it, and all existing engagements pinned to `v1.0`.

### Phase Q2 — Admin questionnaire editor (read-only listing first)

- `GET /questionnaire/versions`, `GET /questionnaire/versions/{id}`, `GET /questionnaire/draft` endpoints.
- New admin route `/admin/questionnaire` showing the three-column layout with current draft loaded. No editing yet — everything read-only.
- Left sidebar nav gets a new "Questionnaire" entry.
- Standard/AI Addendum tabs functional.
- Preview-as-vendor link works (read-only vendor questionnaire rendering from the draft).

### Phase Q3 — Admin questionnaire editor (write)

- Single batched `POST /questionnaire/draft/save` endpoint; no per-mutation endpoints.
- Editor form fields functional: add/edit/delete sections, questions, options; drag-to-reorder; `allows_other` toggle.
- All edits live in client React state until the admin clicks **Save draft** (button in the right metadata panel). Cmd/Ctrl+S triggers save. Dirty state surfaces as an "Unsaved changes" chip, a leading bullet in `document.title`, and a `beforeunload` guard.
- Preview-as-vendor prompts when dirty (save-and-preview vs. preview-last-saved).
- One `questionnaire.draft.saved` audit log entry per save, with summary counts.

### Phase Q4 — Publish flow + diff

- `GET /questionnaire/draft/diff` — computes diff against current version by matching on `question_key`.
- `POST /questionnaire/draft/publish` — the full publish transaction including new draft clone.
- `POST /questionnaire/draft/discard`.
- Publish modal in frontend: diff render, changelog textarea, password, label override.
- Version history view accessible from the metadata panel.

### Phase Q5 — Version-aware engagement rendering

- Update `GET /api/vendor/engagements/{token}`, `GET /api/evaluation/engagements/{token}/responses`, and admin's responses endpoint to return the engagement's pinned version's structure.
- Vendor form, IR read-only view, admin Responses tab all render against pinned version.
- `allows_other` rendering in vendor form: sentinel option + expanded text field.
- Export updated: cover page shows revision suffix, Document Control includes `Questionnaire Version`.

### Phase Q6 — Refresh flow

- `POST /api/admin/engagements/{id}/refresh` endpoint with all the logic above.
- Refresh button on engagement detail (CLOSED / UNDER_REVIEW + latest-revision gate).
- Confirmation modal with password re-entry.
- Carried-over response indicator in vendor form.
- Non-latest-revision banner with "view latest" link.

### Phase Q7 — Dashboard revision grouping + Responses tab revision selector

- Dashboard grouped-by-family view with chevron-expand behaviour (no flat toggle).
- Responses tab revision dropdown and historical-view banner.
- Audit log entries for refresh creation already covered; verify metadata is rich enough for traceability.

---

## Security Checklist — additions

- [ ] `question_options`, `questionnaire_sections`, `questionnaire_versions` tables use UUID PKs.
- [ ] All questionnaire editor endpoints require admin JWT; no endpoints accept writes against non-draft versions.
- [ ] Publish and Refresh require admin password re-confirmation via bcrypt verify.
- [ ] `other_text` input sanitized through `bleach` like all vendor text.
- [ ] `question_key` not accepted from admin input on edit — server-assigned only.
- [ ] Version label override validated against regex and uniqueness.
- [ ] Migration is reversible (`downgrade()` implemented) for rollback safety.

---

## Out of Scope (Explicitly)

- **Cross-revision risk item carry-over** — risk assessments are not pre-filled on refresh. Admin may copy-paste from the predecessor if desired, but the system does not automate it.
- **Side-by-side revision comparison** — a "compare R1 and R2 responses" view is a future enhancement, not required now. The dropdown selector is sufficient.
- **In-place text edits on published versions with history rendering** — if an admin corrects a typo on a published version's question text (allowed per Axiom 1), the correction applies to all engagements using that version. We do not reconstruct the as-of-dispatch text. The audit log is the record.

## Family-Wide File Behaviour (Phase Q7)

Files are presented across the engagement family rather than per-revision:

- The admin **Files tab** lists all family files in a single unified view, each row badged with the revision (`R0`, `R1`, …) it was uploaded against. Default sort is upload date desc. Download is enabled for any file in the family. Delete is enabled only for files belonging to the latest revision; older-revision files are immutable.
- The **IR portal** sees the same unified file list and can download/upload, but can only delete files attached to the revision tied to their token.
- The **Word export** for revision R{N} contains R{N}'s pinned questionnaire, R{N}'s responses, R{N}'s risk assessment, and a **Supporting Documents** section listing all files from R{N} and any earlier revision in the family with revision badges.
- **NDA/SOW** required for `CLOSED` are checked across the entire family for refresh engagements — coverage from R0 satisfies R1's close.
