# Import Engagement — Implementation Prompt

## Required reading (do this first)

Before writing any code, read these files end-to-end. They're the ground truth for conventions, schema, lifecycle, and security posture. Anything in this prompt that appears to conflict with them is a bug in this prompt — flag it and stop, do not silently diverge.

1. `CLAUDE.md` — project overview, tech stack, design system, engagement lifecycle, file-upload security rules, doc-number generation, route layout, security checklist.
2. `CLAUDE-questionnaire-versioning.md` — questionnaire schema, version semantics, the `IMPORTED-` naming convention this prompt extends, response-rendering rules, and the editor/refresh flows.
3. `CLAUDE-md-patch.md` — pending amendments to CLAUDE.md; check whether anything here supersedes the main file.
4. `backend/app/models/` — every SQLAlchemy model touched by this work. Read them all; do not assume column names.
5. `backend/app/services/files.py` — existing file-upload pipeline: magic-byte validation, UUID filename generation, size/count enforcement. **Reuse these helpers verbatim; do not re-implement.**
6. `backend/app/utils/sanitize.py` — text sanitisation (bleach). Every imported text field must pass through this.
7. `backend/app/routers/admin/engagements.py` — where the new `/import` route will live. Mirror its auth dependency, response shape, and audit-log calls.
8. `backend/app/services/audit.py` — audit log writing helpers.
9. `backend/app/routers/admin/questionnaire.py` and `backend/app/services/questionnaire.py` — questionnaire editor endpoints; the version-list query lives here and needs the `WHERE version_name NOT LIKE 'IMPORTED-%'` filter added.
10. `frontend/src/pages/admin/NewEngagement.jsx` — current page; becomes the "Create blank" tab.
11. `frontend/src/pages/admin/Settings.jsx` — existing tab pattern to mirror for the Import prompt tab.
12. `frontend/src/contexts/AuthContext.jsx` — admin auth fetch wrappers; reuse.

If a referenced file does not exist or has been renamed, **stop and report** rather than guessing.

## Context

The ISDD Portal currently creates engagements via the admin "New Engagement" form. We have ~160 historical Due Diligence families on SharePoint, spanning 3+ years, that need to be brought into the system. Re-typing them is not viable.

The historical corpus is **not** a numbered Q→A questionnaire — it is narrative reports organised by section headings ("Executive Summary", "Application Delivery Model", "Identity and Federation", "Disaster Recovery", etc.) with free-form prose under each, sometimes augmented by tables (Document Control, Revision History, Risk Register, SLA). Modern reports also include a typed Risk Assessment table and C/I/A ratings; older ones do not.

This task builds the **import path only**. AI-assisted extraction (turning a Word/PDF report into the import bundle) is performed externally — the user pastes a prompt into any AI tool, gets back JSON + extracted images, packages them into a bundle, and uploads. The importer accepts a ready-to-ingest bundle and nothing else.

## Hard constraints

1. **No database migrations.** The existing schema must absorb imported data as-is. If something doesn't fit (e.g. C/I/A ratings, sub-question grouping), drop it on import — do not add columns. This is a one-time import for 160 fixed items; the app must not warp to fit historical data.
2. **No new enum values, no new file_type values, no new status values.** Use what exists.
3. **No changes to existing functionality.** Vendor portal, IR portal, admin engagement detail, risk assessment editor, Word export, audit log, refresh flow — all behave identically after this change. The only additions are: a tab on `New Engagement`, a tab in Settings, and a single new admin route.
4. **Adapt imports to the app.** When in doubt between extending the app or simplifying the bundle, simplify the bundle.

## What to build

### 1. New admin route + service

- `POST /api/admin/engagements/import` — accepts a multipart upload of a `.zip` bundle. Body: single file field `bundle`. Returns the created root engagement id (or 400 with field-level validation errors).
- New service `app/services/import_engagement.py` containing all bundle parsing, validation, and persistence logic. Keep `routers/admin/engagements.py` thin (delegate to the service).
- The route requires admin JWT (same dependency as every other `/api/admin/*` route).

### 2. UI: import tab on New Engagement

- The existing `NewEngagement.jsx` form becomes one of two tabs at the top of the page:
  - **Create blank** (current behaviour, unchanged)
  - **Import bundle**
- The Import bundle tab is a single dropzone (drag-and-drop + click-to-pick) accepting `.zip` only. Show file name + size after selection. One submit button: **Import**.
- On submit, POST the file to `/api/admin/engagements/import`. While in-flight, disable the dropzone and show a spinner.
- On success, navigate to `/admin/engagements/:id` for the **root** engagement of the imported family (revision 0). On failure, render the server's error response inline above the dropzone — line/field references included if the server returned them. Nothing partial is persisted on failure.
- No client-side schema validation. The server is the source of truth; mirror its errors verbatim.

### 3. UI: Settings → Import prompt tab

- Add a new tab to `Settings.jsx` titled **Import prompt**.
- The tab body is read-only: a heading, two short paragraphs of usage instructions (paste into any AI tool along with the DD report; save the JSON to `engagement.json`; place extracted images in `attachments/`; zip the folder; upload via New Engagement → Import bundle), then a large monospace text block containing the AI extraction prompt (full text — see section "AI extraction prompt" below).
- Provide a **Copy prompt** button that copies the full prompt to clipboard.
- The prompt text itself is stored as a string constant in the frontend (e.g. `frontend/src/constants/importPrompt.js`). No backend endpoint, no DB row. It is not editable from the UI; if the prompt needs to change, the constant is updated and the build is redeployed.

## Bundle format

A single `.zip` containing:

```
bundle.zip
├── engagement.json          # mandatory, root of the zip
└── attachments/             # optional, only if any attachments are referenced
    ├── HLD-diagram.png
    ├── Wheels-NDA.pdf
    └── Original-Report.pdf
```

Rules:
- `engagement.json` must be at the zip root, not nested in a folder.
- Every filename in `attachments/` is referenced in `engagement.json` exactly once across all revisions (no shared files between revisions — if R0 and R1 both reference an NDA, ship two copies under different filenames).
- Every attachment reference in `engagement.json` must resolve to a real file in `attachments/`.
- Unreferenced files in `attachments/` → reject with a clear error.
- No other top-level entries permitted. Reject anything else (defence in depth against zip-slip and path traversal).

## JSON schema

`engagement.json` is a single object. Validate via Pydantic models in `app/schemas/import_engagement.py`.

```jsonc
{
  "schema_version": "1.0",                       // string, must equal "1.0"

  "family": {
    "application_name": "Wheels",                // required, string
    "operating_companies": ["BHT", "AGMC"],      // required, array of OC names that already exist in settings.oc_list (case-insensitive match). Reject if any are unknown.
    "is_ai_application": false,                  // required, bool
    "internal_notes": null,                      // optional, string or null
    "vendor_emails": [],                         // required, array (may be empty for historical imports)
    "ir_emails": [],                             // required, array

    "revisions": [                               // required, length >= 1, ordered by revision_number ascending
      {
        "revision_number": 0,                    // required, integer >= 0; first entry MUST be 0; subsequent entries MUST increment by 1
        "doc_number": "ABHIT-IST-DD-1052",       // required, string; for revision 0 this is the root doc_number; for revision N > 0 this MUST equal "{root}-R{N}"
        "status": "CLOSED",                      // required, must be a value of EngagementStatus enum
        "created_at": "2023-10-25T00:00:00Z",    // required, ISO 8601 UTC
        "submitted_at": "2023-10-25T00:00:00Z",  // optional, ISO 8601 UTC or null

        "questionnaire": {                       // required
          "sections": [                          // required, length >= 0
            {
              "key": "executive_summary",        // required, snake_case slug, unique within this revision's sections
              "title": "Executive Summary",      // required, the section heading as it appeared in the source document
              "order": 1,                        // required, integer >= 1, unique within this revision's sections
              "body_text": "..."                 // required, full prose under the heading (markdown allowed for tables/lists; will be sanitised via bleach before storage)
            }
          ]
        },

        "structured_fields": {                   // optional, all sub-fields optional; matches existing StructuredFields model exactly
          "service_type": "SaaS",
          "hosting_location": "Germany (Frankfurt)",
          "hyperscaler": null,
          "disaster_recovery": "Active/Active across 2 DCs",
          "dr_location": "Frankfurt (secondary)",
          "data_residency_region": "EU",
          "encryption_at_rest": "Tokens only (HashiCorp Vault)",
          "encryption_in_transit": "TLS 1.2",
          "mfa_supported": "Yes (Azure AD / Google / M365 SSO)"
        },

        "risk_assessment": {                     // optional; if present, status must be FINALISED or DRAFT
          "overall_rating": "HIGH",              // required when block present; one of CRITICAL/HIGH/MEDIUM/LOW
          "summary": "...",                      // required when block present; if the source document had C/I/A ratings, prepend them as the first line of the summary, e.g. "C: High | I: High | A: Medium\n\n..."
          "status": "FINALISED",                 // required when block present
          "risks": [                             // required when block present, may be empty
            {
              "description": "...",              // required
              "rating": "HIGH",                  // required
              "assigned_to": ["ABH IT IST"],     // required, array of strings; values do NOT need to match the Assignee settings list (free-text on import)
              "mitigation": "...",               // required
              "order": 1                         // required, integer >= 1
            }
          ]
        },

        "ir_documents": {                        // optional
          "nda_filename": "Wheels-NDA.pdf",                          // optional; if set, must reference a file in attachments/
          "sow_filename": null,
          "functional_evaluation_filename": "Wheels-FE.pdf"
        },

        "attachments": [                         // optional, vendor-side attachments
          {
            "filename": "HLD-diagram.png",       // required; must reference a file in attachments/
            "linked_section_key": "high_level_design_diagram"  // optional; if set, must match a key in this revision's questionnaire.sections; if null, attachment is loose (not tied to a section)
          },
          {
            "filename": "Original-Report.pdf",
            "linked_section_key": null
          }
        ]
      }
    ]
  }
}
```

### Validation rules (Pydantic + service-layer)

- `schema_version == "1.0"` exactly. Future versions handled later.
- `revisions` non-empty, sequential from 0, no gaps.
- `doc_number` for `revision_number == 0` MUST NOT already exist in the engagements table. If it does, return 400 (no merging, no overwrite).
- For revision N > 0: `doc_number` must equal `{root_doc_number}-R{N}` where root is the revision-0 doc number. The MAX+1 sequence is not consulted on import.
- `status` must be one of the existing `EngagementStatus` enum values.
- `operating_companies` names must resolve to existing OC rows (case-insensitive); reject with "Unknown OC: X" otherwise. Do NOT auto-create OCs from imports.
- Every `attachments[].filename`, `ir_documents.nda_filename`, `ir_documents.sow_filename`, `ir_documents.functional_evaluation_filename` must resolve to a file in `attachments/`. Every file in `attachments/` must be referenced exactly once across all revisions in the bundle.
- Every `attachments[].linked_section_key`, when not null, must match a `questionnaire.sections[].key` in the same revision.
- `questionnaire.sections[].key` must be unique within the revision; `order` must be unique within the revision.
- All text fields are run through `utils/sanitize.py` (bleach) before storage, same as vendor/IR inputs.

## Importer logic

Order matters. All steps happen inside a **single async database transaction**. If any step fails, roll back the transaction AND delete any files written to disk during this import.

1. **Receive upload.** Stream the zip to a temp directory (`tempfile.TemporaryDirectory`). Reject if total uncompressed size exceeds 500 MB or if the zip contains > 50 files (defence against zip bombs).
2. **Extract safely.** Iterate `ZipFile.infolist()`; for each entry, resolve the target path and verify it stays within the temp directory (defence against zip-slip via `..` or absolute paths). Reject the bundle on any escape attempt.
3. **Parse `engagement.json`** via the Pydantic schema. Return 400 with Pydantic's error structure on parse failure.
4. **Cross-reference validation** (everything listed under "Validation rules" above).
5. **Magic-byte validation** for every file under `attachments/`. Use `python-magic` (and Pillow for images), exactly as the existing vendor-upload path does — reuse `services/files.py` helpers; do not re-implement. Reject if any file fails.
6. **Pre-flight DB checks.** Doc-number uniqueness, OC name resolution.
7. **Create one QuestionnaireVersion row per revision.** Set `version_name = f"IMPORTED-{root_doc_number}-R{revision_number}"`. Use whatever existing `status` value indicates "published / immutable" in the current enum (do NOT add a new value). The live questionnaire editor's version-list query must be extended to exclude any version whose `version_name` starts with `IMPORTED-` — this is a query change, not a schema change. Verify the existing editor still works after the change.
8. **Create one QuestionnaireSection row per section** inside each version. Map `key → question_key`-style stable identifier, `title → title`, `order → order`. `is_ai_addendum = false` (no inline AI addendum support on import; if the source document had AI addendum sections, they become regular sections).
9. **Create one Question row per section** with `response_type = TEXT`, `is_required = false`, `allows_other = false`, `hint_text = null`, `question_key = section.key`, `question_text = section.title`, `order = section.order`. Synthesising the question this way keeps the existing response renderer working unmodified.
10. **Create the engagement row(s).** Revision 0 first, with `parent_engagement_id = null`. Revision N>0 with `parent_engagement_id = previous_revision.id` (chain to immediate parent — matches the live refresh flow). Pin `questionnaire_version_id` to the row created in step 7. Use the provided `doc_number`, `status`, `created_at`, `submitted_at`, `application_name`, `internal_notes`, `is_ai_application`, `vendor_emails`, `ir_emails`. Generate fresh `vendor_token` and `ir_token` UUIDs.
11. **Link operating_companies** via the many-to-many association.
12. **Create Response rows** — one per section, populated from `body_text` (sanitised). `selected_options = null`, `other_text = null`.
13. **Create StructuredFields row** if `structured_fields` present.
14. **Create RiskAssessment + RiskItem rows** if `risk_assessment` present. C/I/A ratings, if present in the source, are folded into the leading line of `summary` (as instructed in the AI prompt) — no schema changes.
15. **Store attachments via the existing file pipeline.** For each attachment:
    - `attachments[]` entries → `FileUpload` rows with `file_type = VENDOR_ATTACHMENT`, `question_id` = the synthesised question for the linked section (or null if `linked_section_key` is null).
    - `ir_documents.nda_filename` → `IR_NDA`
    - `ir_documents.sow_filename` → `IR_SOW`
    - `ir_documents.functional_evaluation_filename` → `IR_FUNCTIONAL_EVALUATION`
    - Files are copied into `UPLOAD_DIR` (or `IR_UPLOAD_DIR` for IR files), renamed to UUID-based stored filenames, with original filename preserved in the DB row. `uploaded_by` is set to the admin username executing the import. `uploaded_at` is set to the engagement's `created_at`, not now.
16. **Write a single audit log entry per revision** with `action = "engagement.imported"`, `actor_type = ADMIN`, and `metadata = {bundle_filename, file_count, byte_size}`. No per-file audit entries.
17. **Commit transaction.**
18. **Return** `{ "root_engagement_id": "...", "revision_count": N }`.

## AI extraction prompt (text to ship in Settings tab + as `frontend/src/constants/importPrompt.js`)

Ship this exact prompt as a string constant. When updating it, also update the schema in `app/schemas/import_engagement.py` in lockstep.

```
You will convert an Information Security Due Diligence report into a JSON document that conforms to the schema below, ready for import into the Albatha ISDD Portal.

INPUT: a DD report (you may receive it as pasted text, a Word/PDF file, or a screenshot set). The report is organised by section headings with free-form prose under each. It may also contain a Document Control table, a Revision History table, a Risk Assessment table (with Risk / Rating / Mitigation / Responsible columns), and optionally Confidentiality / Integrity / Availability (C/I/A) ratings.

OUTPUT: a single JSON document conforming exactly to the schema below, followed by a plain-text list of any embedded images you saw in the source (filename and a one-line description of each). Output nothing else — no commentary, no preface, no closing remarks.

EXTRACTION RULES:

1. Sections. Every top-level section heading in the report (e.g. "Executive Summary", "Application Delivery Model", "Identity and Federation", "Disaster Recovery", "Logging") becomes one entry in `questionnaire.sections`. Use the heading verbatim as `title`. Generate `key` as a snake_case slug of the title. The `body_text` is the full prose under that heading (preserve paragraph breaks; convert in-text tables to markdown tables; do not summarise). Order sections in the order they appear in the source.

2. Document Control / Revision History tables. Do NOT include these as sections. Use them only to derive the `family.revisions[]` array structure and the `doc_number`, `created_at`, `submitted_at` fields. If the source document is a single revision (one Revision History row), produce one entry in `revisions` with `revision_number: 0`. If the source documents multiple revisions, produce one entry per revision row, in chronological order, with sequential `revision_number` starting at 0.

3. Risk Assessment. If the report contains a Risk Assessment / Risk Register table, populate `risk_assessment` with `overall_rating` (one of CRITICAL/HIGH/MEDIUM/LOW), `summary` (the Risk Summary paragraph if present, otherwise a one-paragraph summary you write from the table), `status: "FINALISED"`, and one entry in `risks[]` per row. Map columns: Risk → description, Risk Rating → rating, Mitigation Recommendation → mitigation, Responsible Person/Team → assigned_to (split on `/` and `,` into an array of trimmed strings). `order` is the row order in the source.

4. C/I/A ratings. If the source has separate Confidentiality / Integrity / Availability ratings, prepend them to `risk_assessment.summary` as the first line in the form: `C: <value> | I: <value> | A: <value>` followed by a blank line, then the rest of the summary. Do NOT invent a separate field for them.

5. Structured fields. Read the prose and populate any of the following that are clearly stated: service_type (e.g. "SaaS", "On-prem", "Hybrid"), hosting_location, hyperscaler (AWS/Azure/GCP/Other), disaster_recovery, dr_location, data_residency_region, encryption_at_rest, encryption_in_transit, mfa_supported. Leave a field null if not clearly stated; do NOT guess.

6. Attachments. List every embedded image, diagram, or referenced external document you can see. For embedded images: extract them, save them with descriptive filenames (e.g. "HLD-diagram.png", "architecture-overview.png"), and add an entry to `attachments[]` with `linked_section_key` set to the key of the section the image appeared in. For loose vendor documents referenced in the prose (e.g. "see attached SOC 2 report"), add them with `linked_section_key: null`. Do NOT include the original DD report itself as an attachment — that is recorded elsewhere.

7. IR documents. If the report references an NDA, SOW, or Functional Evaluation document, set `ir_documents.nda_filename`, `ir_documents.sow_filename`, or `ir_documents.functional_evaluation_filename` to the filename you used for it. Otherwise leave the field null.

8. application_name. The product/application the DD is about, NOT the requesting operating company.

9. operating_companies. The internal Albatha operating company/companies that requested the DD. If the source mentions specific OCs (e.g. "BHT", "AGMC", "Tecon", "IBO"), list them as an array. If unclear, return an empty array and the user will fill it in.

10. is_ai_application. Set true if the DD is for an AI/ML product (e.g. ChatGPT, Claude, Gemini, Copilot, an analytics platform using ML). False otherwise.

11. status. Default to "CLOSED" for historical imports. Use a different EngagementStatus only if the source clearly indicates the DD is still in progress.

12. Emails. Leave `vendor_emails` and `ir_emails` as empty arrays unless the source contains explicit email addresses for vendor or IR contacts.

13. Dates. Use the document's publish date or the date of the row in the Revision History for `created_at` and `submitted_at`. Format as ISO 8601 UTC midnight (e.g. "2023-10-25T00:00:00Z") if only a date is available.

SCHEMA:

[INSERT THE FULL JSON SCHEMA BLOCK FROM THIS FILE — copy the example JSON from the "JSON schema" section verbatim, with all `//` field comments stripped out so the output is valid JSON.]

After the JSON, on a new line, output exactly:

---
Embedded images:
- <filename1>: <one-line description>
- <filename2>: <one-line description>
(or "Embedded images: none" if there are no images)
```

> Implementation note: when generating `importPrompt.js`, inline the schema as syntactically valid JSON (strip all `//` comments). The version with comments in this file is for developer reference only.

## Acceptance criteria

- [ ] `prompts/import-engagement.md` is the source of truth for this work — anything ambiguous defaults to what's written here, not to inference from other features.
- [ ] `POST /api/admin/engagements/import` accepts a `.zip`, validates the bundle, persists the engagement family atomically, and returns the root engagement id.
- [ ] Invalid bundles produce 400 with a clear, actionable error (which field, which file, which line of `engagement.json`). No partial state is ever persisted.
- [ ] Zip-slip and zip-bomb defences are in place and tested.
- [ ] Magic-byte validation runs on every attachment, using the existing helpers in `services/files.py`.
- [ ] Imported engagements show up in the existing engagements list and inventory dashboard with no special-case handling — they look identical to engagements created via the live flow.
- [ ] Opening an imported engagement's detail view: structured fields, responses (one per section), risk assessment (if present), attachments, IR documents — all render via existing UI components with zero changes.
- [ ] Imported engagements can be exported to Word via the existing `/export` endpoint with no special-case logic. The Word output renders the synthesised TEXT-question sections cleanly.
- [ ] Imported families with multiple revisions surface correctly in the engagement-detail revision dropdown and in the inventory dashboard's family grouping.
- [ ] The questionnaire editor in Settings does NOT show any `IMPORTED-*` versions. The version-history view in the editor confirms this.
- [ ] The Settings → Import prompt tab renders the prompt text and the Copy button works.
- [ ] The New Engagement page renders both tabs; "Create blank" behaves identically to today; "Import bundle" works end-to-end.
- [ ] Audit log records `engagement.imported` for each imported revision.
- [ ] Round-trip placeholder: the JSON schema is documented in such a way that the future export feature (`prompts/export-engagement.md`) can emit the same shape without renegotiation. Do not implement export here; just ensure no field in the schema is import-only-coherent.

## Out of scope (explicit)

- AI-driven extraction inside the app (the prompt is user-facing only; no `/extract-from-pdf` endpoint).
- Editing the bundle from inside the app (no preview-and-tweak — bundle is opaque on the way in).
- Bulk import of multiple families in one upload (one bundle = one family).
- Auto-creation of OCs from imports (existing OC list is authoritative).
- Auto-creation of assignees from `risk_assessment.risks[].assigned_to` (free-text on import; the live risk editor still uses the Assignee list).
- Migration of historical email threads, attachments outside the SharePoint DD folder, or vendor metadata not captured in the report.
- Idempotency / re-import / merge. Re-importing a doc number that already exists is a hard 400.
- Updating an existing engagement by importing a newer revision separately. To import a family, ship all of its revisions in one bundle. To add a revision to an already-imported family, use the existing live Refresh flow.

## Overlap with planned export work

The same `engagement.json` schema and bundle layout are intended to be used by the upcoming export prompts (`prompts/export-engagement.md` and `prompts/export-full-instance.md`). Specifically:

- **Per-engagement export** will emit exactly the bundle this importer accepts. A round-trip (export → fresh-instance import) must reproduce the engagement, modulo the documented lossy fields (C/I/A separation, since C/I/A is folded into the summary on import; any data outside the schema that the app doesn't model).
- **Full-instance export** will be a zip-of-zips: one bundle per family, plus a top-level `instance.json` capturing settings (OC list, assignees, admin-managed questionnaire versions). The full-instance importer (separate prompt) will need to restore settings BEFORE the engagement bundles, since engagement imports depend on the OC list.

Design implications for this prompt:
- Do not bake import-only behaviour into the schema or service. Keep the bundle format symmetrical.
- The `services/import_engagement.py` module's bundle-parsing and validation logic should be reusable by the future full-instance importer (factor the zip-extract + Pydantic-validation steps so they can be invoked per-family from a wrapping flow).
- The IMPORTED- version-name prefix convention is a one-way decision: imports get it, exports must preserve it on round-trip, the live editor always filters it out. Document this in `CLAUDE-questionnaire-versioning.md` when implementing.

## Verification / test plan

1. **Unit test the Pydantic schema** with a minimal valid bundle JSON, plus deliberately broken variants (missing required field, bad revision_number sequence, unknown OC, doc_number with wrong `-R{N}` suffix, attachment file missing, attachment file unreferenced, `linked_section_key` pointing at a non-existent section).
2. **Unit test the zip extractor** against zip-slip (`../escape.txt`), absolute paths, zip bombs (>500MB uncompressed, >50 files), and nested folders.
3. **Integration test the full importer** by building a fixture bundle for DD-1052 Wheels (use both R0 and R1 from the SharePoint folder — see context note below) and asserting:
   - Two engagements created, linked via `parent_engagement_id`.
   - Two QuestionnaireVersion rows with `IMPORTED-` prefix.
   - The expected number of Section + Question + Response rows.
   - Embedded HLD diagram stored as a FileUpload with `file_type = VENDOR_ATTACHMENT` and the correct `question_id`.
   - Audit log has exactly two `engagement.imported` entries.
   - Loading `/admin/engagements/{R0_id}` and `/admin/engagements/{R1_id}` renders without error.
4. **Manual UI test**: New Engagement → Import bundle → upload the Wheels fixture → land on the engagement detail → verify revision dropdown shows R0 and R1 → verify Settings → Import prompt tab renders and Copy works → verify questionnaire editor does NOT show the imported versions.
5. **Regression**: run the existing test suite. Nothing outside this scope should change behaviour. In particular: the questionnaire editor, the live New Engagement form, vendor/IR portals, Word export, and the engagements list/inventory dashboard.

### Context: Wheels fixture source

Two real reports live at (translate from Windows path; accessible via `/mnt/c/...` on this WSL host):

- `C:\Users\ahmedhamza\Albatha Holding LLC\CyberSecurity - Documents\ISMS\Cyber Defense\Application Security\Due diligence\DD-1052 Wheels\ABHIT-DD-1052 Due Diligence Report Wheels v1.1.pdf` — treat as R0 of doc `ABHIT-IST-DD-1052`.
- `C:\Users\ahmedhamza\Albatha Holding LLC\CyberSecurity - Documents\ISMS\Cyber Defense\Application Security\Due diligence\DD-1052 Wheels\ABHIT-IST-DD-1052 Due Diligence Report Wheels.pdf` — treat as R1 (doc number suffix `-R1`).

Use the `.docx` siblings in the same folder when building the fixture — they extract cleanly via the `zipfile` + `xml.etree` route (no poppler needed). The two embedded images per doc (HLD diagram .tiff and a screenshot .png) become the fixture's attachments.

## On completion

When the implementation is functionally complete and the verification plan above passes:

1. **Update documentation.** Do not create new top-level docs — extend the existing ones.
   - `CLAUDE.md`: add an entry under "Build Phases" recording that historical-DD import is now available. Reference the new endpoint (`POST /api/admin/engagements/import`), the New Engagement tab, the Settings → Import prompt tab, and the `IMPORTED-` version-name convention. If a "Security Checklist" item is now satisfied by this work (e.g. import-path file-upload checks), tick it.
   - `CLAUDE-questionnaire-versioning.md`: document the `IMPORTED-` version-name prefix, the per-engagement synthetic-version pattern, and the fact that the live editor filters out IMPORTED- versions.
   - `README.md`: add a short "Importing historical DDs" section pointing users at New Engagement → Import bundle and Settings → Import prompt.

2. **Commit.**
   - One commit, or a small number of focused commits if backend / frontend / docs are cleanly separable. Avoid one mega-commit; avoid one-commit-per-file noise.
   - Follow the existing commit-message style (`git log --oneline -20`): short subject line, descriptive of the change, no ticket prefixes (the repo doesn't use them).
   - Include the project's `Co-Authored-By: ...` footer per the standard commit protocol.
   - **Do not push.** The user pushes to `origin` (github main) and `gitlab` (feature/current branch) themselves on their own cadence.

3. **Do not delete this prompt file.** It stays in `prompts/` as the permanent specification reference. If the implementation diverges from this prompt in any non-trivial way, update the prompt to match before committing — the prompt should always reflect what's actually in the code.
