# Full-Instance Export & Restore — Implementation Prompt

## Required reading (do this first)

Before writing any code, read these files end-to-end. They're the ground truth for conventions, schema, lifecycle, and security posture. Anything in this prompt that appears to conflict with them is a bug in this prompt — flag it and stop, do not silently diverge.

1. `CLAUDE.md` — project overview, tech stack, design system, engagement lifecycle, file-upload security rules, security checklist, audit logging conventions.
2. `CLAUDE-questionnaire-versioning.md` — questionnaire schema, version semantics, the `IMPORTED-` naming convention (relevant because IMPORTED- versions travel inline with their engagement, while live versions are referenced by id).
3. `CLAUDE-md-patch.md` — pending amendments to CLAUDE.md; check whether anything here supersedes the main file.
4. `prompts/import-engagement.md` — the sibling historical-DD import prompt. The export bundle and the import bundle are **distinct schemas**; reading the import prompt ensures you don't accidentally unify them.
5. `backend/app/models/` — every SQLAlchemy model in the codebase. Read them all; the export must serialise and the restore must deserialise every column.
6. `backend/app/services/files.py` — file-upload pipeline (magic-byte validation, UUID filenames, size/count enforcement). **Reuse these helpers verbatim** during restore.
7. `backend/app/utils/sanitize.py` — text sanitisation; not directly used by export, but restore writes must not re-introduce unsanitised content.
8. `backend/app/services/audit.py` — audit log writing helpers; restore writes a single `instance.restored` entry plus `engagement.restored.renamed` for each renamed family.
9. `backend/app/services/lifecycle.py` and `backend/app/routers/admin/engagements.py` — engagement creation paths. The restore must produce DB rows indistinguishable from these, but **must not call them** (it preserves UUIDs, tokens, timestamps that those paths regenerate).
10. `backend/app/routers/admin/settings.py` — existing settings router; the new endpoints live here.
11. `backend/app/services/questionnaire.py` and `backend/app/routers/admin/questionnaire.py` — live questionnaire version management; understand the existing read paths before adding the export's version dump.
12. `frontend/src/pages/admin/Settings.jsx` — existing tab pattern; the Backup & Restore tab follows it exactly.
13. `frontend/src/contexts/AuthContext.jsx` — admin auth fetch wrappers; reuse.

If a referenced file does not exist or has been renamed, **stop and report** rather than guessing.

## Context

The ISDD Portal needs a way to dump and restore the entire instance — every engagement family, every setting, every audit entry, every uploaded file — so an admin can move data between servers, back up before a destructive change, or seed a new environment.

This replaces the deferred "Database backup" feature from Phase 2/3. There is no separate per-family export; if a single family needs to be migrated, the admin exports the full instance and the restore path's conflict resolution skips everything except that family.

The historical-DD import flow built per `prompts/import-engagement.md` is a different, narrower path — it accepts a different schema and stays unchanged. Do not unify them.

## Hard constraints

1. **No database migrations.** The export reads what exists; the restore writes back into the same schema. Anything that isn't in the model today does not get exported.
2. **No new enum values, no new file_type values, no new status values.**
3. **No changes to existing functionality.** The only additions are: a Settings → **Backup & Restore** tab, two new admin endpoints, and a small temp-storage utility for in-flight restore sessions.
4. **Streaming everywhere.** A 650 MB+ bundle must never be fully materialised in RAM. Use `zipfile` writing to a `StreamingResponse` for export; stream-extract on restore.
5. **Atomic restore.** Everything succeeds or the database rolls back; files written during a failed restore are deleted from disk.

## What to build

### 1. Backend endpoints

- `POST /api/admin/settings/instance/export`
  Body: `{ "passphrase": "..." }`. Generates an AES-encrypted zip and streams it as the response. Filename: `isdd-instance-{ISO-date}.zip`. Streams chunked; never builds the full archive in memory.

- `POST /api/admin/settings/instance/restore/upload`
  Multipart: `bundle` file + `passphrase` form field. Decrypts, extracts to a temp directory, parses every JSON file, runs preflight conflict detection. Returns:
  ```json
  {
    "session_id": "uuid",
    "expires_at": "...",
    "summary": { "families": 162, "oc_entries": 14, "assignees": 22, "questionnaire_versions": 3, "audit_entries": 4810 },
    "conflicts": {
      "families": [
        { "doc_number": "ABHIT-IST-DD-1052", "incoming_application_name": "Wheels", "existing_application_name": "Wheels" }
      ],
      "questionnaire_versions": [
        { "version_name": "v2.0", "incoming_section_count": 8, "existing_section_count": 9 }
      ]
    }
  }
  ```
  Bundle stays decrypted on disk under a path keyed by `session_id`; TTL 30 minutes; cleaned up by an in-process background task. No conflicts: `conflicts` is empty.

- `POST /api/admin/settings/instance/restore/execute`
  Body: `{ "session_id": "...", "resolutions": { "families": [...], "questionnaire_versions": [...] } }`. Each resolution entry chooses one of:
  - `skip` — do not restore this item
  - `rename` — restore under a new doc_number / version_name (the new value is provided in the resolution)

  Executes the restore inside a single async DB transaction; rolls back on any failure. Returns counts of items inserted, skipped, renamed. Wipes the temp directory on completion or failure.

- `DELETE /api/admin/settings/instance/restore/{session_id}`
  Explicit cleanup if the admin abandons the flow. The background task also cleans up after TTL.

All four endpoints require admin JWT. The export endpoint requires bcrypt re-verification of the admin password as a defence against session hijack — admin re-enters their password in the export dialog; the endpoint verifies before doing any work. The restore endpoints do the same.

Rate-limit every endpoint to 5 requests per hour per admin session (export and restore are both expensive; abuse should be hard).

### 2. New services

- `app/services/instance_export.py` — read-side: queries DB, materialises the bundle on the fly. Functions: `stream_export_bundle(passphrase) -> AsyncIterator[bytes]`.
- `app/services/instance_restore.py` — write-side: preflight scan, conflict detection, atomic restore. Functions: `preflight(bundle_path) -> PreflightReport`, `execute(session_id, resolutions) -> RestoreSummary`.
- `app/services/restore_session.py` — temp-storage manager: create/get/delete session directories under `BACKUP_DIR/restore-sessions/{session_id}`, TTL cleanup.

Keep `routers/admin/settings.py` thin. Delegate everything to the services.

### 3. UI: Settings → Backup & Restore tab

A new tab in `Settings.jsx`. Two clearly separated panels stacked vertically.

**Export panel** (top half):
- Heading: "Export full instance"
- One paragraph of usage notes (this produces an encrypted archive containing every engagement, setting, file, and audit entry; keep the passphrase safe, the archive cannot be opened without it).
- Passphrase input (masked, minimum 12 characters, with a strength indicator) + confirm-passphrase input.
- Admin password input (also masked) — required for the export endpoint.
- **Export** button. While streaming: show a determinate progress bar driven by the `Content-Length` header if available, otherwise an indeterminate spinner. On success: trigger browser download via blob URL.

**Restore panel** (bottom half), itself two phases.

*Phase A — Upload & preflight:*
- Heading: "Restore from an export"
- Single dropzone accepting `.zip` only.
- Passphrase input (masked) + admin password input (masked).
- **Scan bundle** button. Submits to `/restore/upload`. Disables inputs while in-flight.
- On response, expand to Phase B. If the response shows zero conflicts, skip directly to Phase B's confirmation step.

*Phase B — Conflict resolution & confirm:*
- Summary line: "Bundle contains 162 families, 14 OC entries, 22 assignees, 3 questionnaire versions."
- If conflicts exist, a table of conflicting families: columns are `Doc number (incoming)`, `Application (incoming)`, `Application (existing)`, `Action` (radio: Skip / Rename), `New doc number` (input, only enabled when Rename is selected).
- Same shape for conflicting questionnaire versions.
- Validation: when Rename is selected, the new doc_number must be (i) syntactically valid (matches the existing `ABHIT-IST-DD-NNNN` pattern OR a free-form string the user types — be permissive), (ii) not already in the target database, (iii) not already used as a rename target in this same session.
- **Cancel** button (calls `DELETE /restore/{session_id}` and resets the panel).
- **Apply restore** button. Disabled until every conflict has a resolution. On click: show a confirm modal ("This will write 162 families and N files to the database. Proceed?") and on confirm, POST `/restore/execute`. While in-flight: indeterminate spinner, all inputs disabled. On success: show a summary card with counts (inserted, renamed, skipped) and a link to the engagements list. On failure: render the server error inline; nothing is partially applied.

The Backup & Restore tab is the only place this functionality lives. No CLI, no env-var auto-restore, no scheduled exports. (Cron-style automation can be a later feature.)

## Bundle format

A single `.zip` (AES-256 encrypted via `pyzipper` or equivalent; do **not** use the legacy ZipCrypto cipher — it is broken).

```
isdd-instance-2026-06-01.zip
├── instance.json                       # metadata + manifest
├── settings/
│   ├── oc_list.json
│   ├── assignees.json
│   └── questionnaire_versions.json     # all admin-managed versions (live), with sections/questions/options
├── audit_log_system.json               # AuditLog rows where engagement_id IS NULL
└── families/
    ├── ABHIT-IST-DD-1001/
    │   ├── engagement.json             # see schema below
    │   ├── audit_log.json              # AuditLog rows where engagement_id matches any revision in this family
    │   └── attachments/
    │       ├── <stored_filename_1>
    │       ├── <stored_filename_2>
    │       └── ...
    ├── ABHIT-IST-DD-1052/
    │   └── ...
    └── ...
```

Notes:
- Family folder name is the **root** doc_number (revision 0's doc_number — the form without the `-R{N}` suffix). All revisions of the family live inside that one folder.
- Attachment files in `attachments/` keep their UUID-based `stored_filename` from the FileUpload table. The `engagement.json` references them by `stored_filename`, not original filename. This makes the export's filenames deterministic and stable across re-exports.
- The bundle is encrypted in transit by virtue of being downloaded over the same HTTPS the admin portal uses; the AES layer protects the file at rest if the admin saves it anywhere.

## JSON schemas

### `instance.json`

```jsonc
{
  "schema_version": "1.0",
  "bundle_type": "instance-export",                     // distinguishes from the historical-import bundle
  "source": {
    "exported_at": "2026-06-01T12:34:56Z",
    "doc_number_prefix": "ABHIT-IST-DD-",
    "doc_number_start": 1001,
    "app_version": "<git short sha or app version string, optional>"
  },
  "counts": {
    "families": 162,
    "engagements": 178,                                 // sum of all revisions across families
    "responses": 12450,
    "file_uploads": 980,
    "audit_entries": 4810
  }
}
```

### `settings/oc_list.json`

```json
[
  { "id": "<uuid>", "name": "BHT" },
  { "id": "<uuid>", "name": "AGMC" }
]
```

### `settings/assignees.json`

```json
[
  { "id": "<uuid>", "name": "ABH IT IST", "type_label": "Team" },
  { "id": "<uuid>", "name": "Legal", "type_label": null }
]
```

### `settings/questionnaire_versions.json`

Full structure for each admin-managed (live) version. **Exclude any version whose `version_name` starts with `IMPORTED-`** — those are per-engagement synthetic versions and travel inside their engagement's `engagement.json`.

```jsonc
[
  {
    "id": "<uuid>",
    "version_name": "v2.0",
    "status": "PUBLISHED",
    "created_at": "...",
    "published_at": "...",
    "sections": [
      {
        "id": "<uuid>",
        "key": "executive_summary",
        "title": "Executive Summary",
        "order": 1,
        "is_ai_addendum": false,
        "questions": [
          {
            "id": "<uuid>",
            "question_number": 1,
            "question_key": "...",
            "question_text": "...",
            "response_type": "TEXT",                    // TEXT / SINGLE_CHOICE / MULTI_CHOICE / FILE_UPLOAD
            "allows_other": false,
            "hint_text": null,
            "is_required": true,
            "order": 1,
            "options": [
              { "id": "<uuid>", "label": "Yes", "order": 1 },
              { "id": "<uuid>", "label": "No", "order": 2 }
            ]
          }
        ]
      }
    ]
  }
]
```

### `families/{root_doc}/engagement.json`

This is the **extended** schema — richer than the historical-import bundle. It carries everything needed for a true 1:1 restore.

```jsonc
{
  "schema_version": "1.0",
  "bundle_type": "instance-export-family",

  "family": {
    "root_doc_number": "ABHIT-IST-DD-1052",
    "application_name": "Wheels",
    "operating_companies": ["BHT", "AGMC"],
    "is_ai_application": false,
    "internal_notes": "...",
    "vendor_emails": ["..."],
    "ir_emails": ["..."],

    "revisions": [
      {
        "id": "<uuid>",                                 // preserved
        "parent_engagement_id": null,                   // for R0; uuid of previous revision for R>0
        "revision_number": 0,
        "doc_number": "ABHIT-IST-DD-1052",
        "status": "CLOSED",
        "vendor_token": "<uuid>",                       // preserved so existing vendor links keep working
        "ir_token": "<uuid>",                           // preserved so existing IR links keep working
        "created_at": "...",
        "updated_at": "...",
        "submitted_at": "...",

        "questionnaire_version": {
          "kind": "live" | "imported",                  // "live" → references settings/questionnaire_versions.json by id; "imported" → inlined here
          "id": "<uuid>",                               // when kind=live, must match one of settings/questionnaire_versions.json
          "inline": { /* same shape as a questionnaire_versions.json entry */ }   // only when kind=imported (IMPORTED- prefixed versions travel with their engagement)
        },

        "responses": [
          {
            "id": "<uuid>",
            "question_id": "<uuid>",                    // resolves against the questionnaire_version (live or inline)
            "response_text": null,
            "selected_options": ["Yes"],
            "other_text": null,
            "updated_at": "..."
          }
        ],

        "structured_fields": {
          "id": "<uuid>",
          "service_type": "...",
          "hosting_location": "...",
          "hyperscaler": null,
          "disaster_recovery": "...",
          "dr_location": "...",
          "data_residency_region": "...",
          "encryption_at_rest": "...",
          "encryption_in_transit": "...",
          "mfa_supported": "...",
          "updated_at": "..."
        },

        "risk_assessment": {
          "id": "<uuid>",
          "overall_rating": "HIGH",
          "summary": "...",
          "status": "FINALISED",
          "created_at": "...",
          "updated_at": "...",
          "risks": [
            {
              "id": "<uuid>",
              "description": "...",
              "rating": "HIGH",
              "assigned_to": ["..."],
              "mitigation": "...",
              "order": 1
            }
          ]
        },

        "files": [
          {
            "id": "<uuid>",
            "question_id": "<uuid or null>",            // null for IR docs and loose attachments
            "file_type": "VENDOR_ATTACHMENT",           // or IR_NDA / IR_SOW / IR_FUNCTIONAL_EVALUATION
            "original_filename": "HLD-diagram.png",
            "stored_filename": "abc123-...",            // matches a file in attachments/
            "mime_type": "image/png",
            "file_size_bytes": 24576,
            "uploaded_by": "vendor@example.com",
            "uploaded_at": "..."
          }
        ]
      }
    ]
  }
}
```

### `audit_log_system.json` and `families/{root_doc}/audit_log.json`

```jsonc
[
  {
    "id": "<uuid>",
    "engagement_id": "<uuid or null>",                  // null in audit_log_system.json; populated in per-family files
    "actor": "admin",
    "actor_type": "ADMIN",
    "action": "engagement.created",
    "description": "...",
    "metadata": { /* JSONB */ },
    "created_at": "..."
  }
]
```

## Export logic

1. **Verify admin password** (bcrypt). Reject on mismatch with generic 401.
2. **Resolve passphrase strength** (min 12 chars). Reject otherwise with 400 (this is a real validation, not security through obscurity — short passphrases are a footgun).
3. **Open an encrypted zip stream** (`pyzipper.AESZipFile` in write mode, AES-256). The stream is wrapped in a `StreamingResponse` with `media_type="application/zip"` and a `Content-Disposition` attachment header.
4. **Write `instance.json` first.** Counts are gathered up front (one query per count).
5. **Stream `settings/oc_list.json`, `settings/assignees.json`, `settings/questionnaire_versions.json`** in order. The questionnaire versions query joins sections, questions, and options eagerly to avoid N+1.
6. **Stream `audit_log_system.json`** by paging through AuditLog rows where `engagement_id IS NULL`, ordered by `created_at`, in batches of 1000. Write each batch as JSON array fragments (open `[`, write entries with commas, close `]`).
7. **For each family** (grouped by `parent_engagement_id IS NULL` and walking revisions via `parent_engagement_id`):
   a. Materialise `engagement.json` for the whole family. The `questionnaire_version.kind` is `"imported"` if the version's `version_name` starts with `IMPORTED-` (in which case the full version structure is inlined), otherwise `"live"` (just the id reference).
   b. Write `engagement.json` to the zip under `families/{root_doc}/`.
   c. Stream the per-family `audit_log.json` from a paged query.
   d. For each FileUpload row in the family, open the file from disk and stream it into `families/{root_doc}/attachments/{stored_filename}`. If a referenced file is missing on disk, log a warning to the audit log (`instance.export.file_missing`) and continue — do not fail the entire export, but record the gap in `instance.json.counts` so the admin sees a mismatch.
8. **Finalise the zip stream.** Audit log entry: `instance.exported`, metadata: counts, bundle size, actor.
9. **Never write to a temp file unless the streaming library requires it** (pyzipper does support streaming via file-like wrappers — verify before settling on a temp-file approach; a temp-file fallback is acceptable as long as it's cleaned up on response close).

## Restore logic (preflight + execute)

### Preflight (`/restore/upload`)

1. Verify admin password.
2. Stream the upload to `BACKUP_DIR/restore-sessions/{session_id}/bundle.zip` with size and member-count guards (max 5 GB, max 50,000 members — defence against zip bombs).
3. Decrypt + extract safely to `BACKUP_DIR/restore-sessions/{session_id}/extracted/`. Same zip-slip / absolute-path defences as the historical-import path.
4. Parse `instance.json`. Reject if `bundle_type != "instance-export"` or `schema_version != "1.0"`.
5. Parse every other JSON file, validate via Pydantic schemas in `app/schemas/instance_export.py`.
6. **Conflict detection** against the target DB:
   - **Families**: for each family folder, look up `root_doc_number` in `engagements` where `parent_engagement_id IS NULL`. If found → conflict.
   - **OC list / assignees**: case-insensitive name match. Existing rows are silently skipped; no conflict report needed (the user doesn't need to resolve "this OC already exists" — we just don't add it again). Counts are surfaced in `summary` for transparency.
   - **Questionnaire versions (live)**: exact `version_name` match. Conflicts are reported. If incoming and existing have identical structure (same sections + questions + options), auto-skip; otherwise require resolution.
   - **Audit log entries**: insert by `id`. If the id already exists, skip silently. No conflict report.
7. Spawn a background task to delete the session directory after 30 minutes. Return the session id + report.

### Execute (`/restore/execute`)

1. Look up the session; reject if missing or expired.
2. Validate that every reported conflict has a resolution in the request body.
3. Open one DB transaction.
4. **Settings first.**
   - OC list: insert any incoming row whose `name` doesn't exist in the target (case-insensitive).
   - Assignees: same shape (insert missing by name).
   - Questionnaire versions: for each, either insert verbatim, skip (per resolution), or rename (per resolution). Inserting verbatim is allowed only when the `id` doesn't exist on target; if the id collides but the name doesn't, regenerate the id and let engagements' inline references resolve via the original id stored in the bundle's `questionnaire_version.id` field — handled in step 6.
5. **Audit log (system-wide)** entries inserted by id, skipping duplicates.
6. **Families.** For each:
   - Apply the resolution: skip → continue; rename → use the new doc_number; default → use bundle's doc_number.
   - **If renamed**, append a paragraph to `internal_notes` and write an audit entry:
     - `internal_notes` gets a section appended: `\n\n---\n[Restored on {ISO date}: doc_number changed from {old} to {new}.]`
     - AuditLog: `action = "engagement.restored.renamed"`, `metadata = {old_doc_number, new_doc_number, session_id}`.
   - Insert engagement rows in revision order. Preserve UUIDs, tokens, timestamps. If `questionnaire_version.kind == "imported"`, materialise the inline version + its sections/questions/options (IMPORTED- name stays, prefix preserved). If `kind == "live"`, resolve `id` against the target's questionnaire_versions; if the live version was renamed in step 4, follow the rename map.
   - Insert responses, structured_fields, risk_assessment + items, files (DB rows).
   - Copy attachment files from `extracted/families/{root_doc}/attachments/` to `UPLOAD_DIR` (or `IR_UPLOAD_DIR` for IR file types), keeping the `stored_filename`. **Run magic-byte validation on every file** before accepting it (reuse `services/files.py` helpers).
   - **Per-family audit log** entries inserted by id, with `engagement_id` rewritten if the engagement's id was regenerated (shouldn't happen unless we hit an id collision — in which case ALL of that family's references need rewriting, treat it as a session-level abort and surface a clear error).
7. **Single restore audit entry**: `action = "instance.restored"`, `metadata = {session_id, family_count, renamed_count, skipped_count, file_count}`.
8. Commit. Wipe the session directory.
9. Return the summary.

## Encryption

- AES-256, via `pyzipper`. `pyzipper.AESZipFile(..., encryption=pyzipper.WZ_AES)`.
- Passphrase is provided by the admin at export time and required at restore time. The app never stores it.
- Reject passphrases shorter than 12 characters (back-end validation, return 400 with a clear message — not a security feature, just a footgun guard).
- The encryption layer is documented in the export panel's UI copy so the admin knows the archive cannot be opened without the passphrase.

## Acceptance criteria

- [ ] `prompts/export-full-instance.md` is the source of truth for this work.
- [ ] `POST /api/admin/settings/instance/export` streams an AES-encrypted zip of the full instance. Re-running it produces an archive that decrypts and parses cleanly.
- [ ] `POST /api/admin/settings/instance/restore/upload` correctly identifies conflicts on a target containing pre-existing engagements that share doc numbers with the bundle, and returns zero conflicts on a clean target.
- [ ] `POST /api/admin/settings/instance/restore/execute` is atomic — any failure during write rolls back the DB transaction and removes any files written during this attempt.
- [ ] Restoring into a clean instance produces an exact functional duplicate: every engagement detail page, every vendor/IR link (using preserved tokens), every audit entry, every uploaded file is reproduced.
- [ ] Restoring into a non-empty instance with conflicting doc numbers: admin renames each conflict; the resulting engagements have a paragraph appended to `internal_notes` noting the rename and a corresponding `engagement.restored.renamed` audit entry.
- [ ] Imported (`IMPORTED-*`) questionnaire versions round-trip — they are inlined inside their engagement's `engagement.json`, not in `settings/questionnaire_versions.json`. The questionnaire editor in Settings still ignores them after restore.
- [ ] Live questionnaire versions referenced by multiple engagements are written once to `settings/questionnaire_versions.json` and resolved by id during restore.
- [ ] Zip-slip / zip-bomb / wrong-passphrase / non-zip-payload all rejected with clear 400s.
- [ ] Magic-byte validation runs on every attachment during restore.
- [ ] The Settings → Backup & Restore tab works end-to-end via the UI: export with passphrase + admin password; restore upload → conflict resolution → execute → summary.
- [ ] Existing functionality (vendor/IR portals, engagement detail, questionnaire editor, inventory dashboard, Word export, audit log views, historical-DD import) is unaffected.
- [ ] No new DB migrations.

## Out of scope (explicit)

- Per-family export. (The full-instance restore's conflict-resolution flow lets you bring across just one family by skipping everything else; that satisfies the rare "I need one family" case.)
- Scheduled / cron-driven exports.
- Diffs between exports (the bundle is a snapshot, not a delta).
- Incremental restore (apply only what changed). All-or-nothing.
- Cross-version restore (bundles produced by `schema_version: "1.0"` only).
- Auto-restore on app boot.
- Encryption key escrow, recovery, or splitting.
- CLI/API export for non-admin actors.

## Relationship to the historical-DD import (`prompts/import-engagement.md`)

These are **distinct features** with **distinct bundle schemas**:

| Aspect | Historical-DD import | Full-instance export/restore |
|---|---|---|
| Endpoint | `/api/admin/engagements/import` | `/api/admin/settings/instance/{export,restore/*}` |
| Trigger | New Engagement → Import bundle tab | Settings → Backup & Restore tab |
| Bundle scope | One family | Whole instance |
| `bundle_type` | absent | `"instance-export"` / `"instance-export-family"` |
| Question schema | Synthesised TEXT-only sections (`body_text`) | Full vocabulary (TEXT / SINGLE_CHOICE / MULTI_CHOICE / FILE_UPLOAD, options, hints) |
| Preserves UUIDs/tokens | No (regenerated) | Yes |
| Conflict handling | 400 on existing doc_number | Rename / skip via preflight |
| Questionnaire versions | Always creates `IMPORTED-*` synthetic | Preserves both live versions (referenced by id) and IMPORTED- versions (inlined) |

The historical-DD importer's `engagement.json` is **not** interchangeable with the full-instance restore's per-family `engagement.json`. The instance restore should detect `bundle_type` and reject mismatches with a clear error.

Where there is shared logic — zip-slip-safe extraction, magic-byte validation, audit log writing — factor into reusable helpers (likely already present in `services/files.py`; if not, extract on this work without changing existing call sites).

## Verification / test plan

1. **Unit tests for export schemas** — Pydantic round-trip of each JSON file in the bundle.
2. **Integration test: clean export + clean restore.**
   - Seed a test DB with a small but representative dataset (2 live engagements with full responses, 1 imported family with R0+R1, OC list, assignees, one live questionnaire version, ~20 audit entries, ~10 attachments).
   - Run export → save zip → wipe DB → run restore (upload + execute with no conflicts).
   - Assert: row counts match exactly; engagement detail pages render identically; vendor token URLs still resolve; uploaded files are byte-identical to originals.
3. **Integration test: conflict resolution.**
   - Seed target with one engagement at `ABHIT-IST-DD-1052`.
   - Restore a bundle that also contains `ABHIT-IST-DD-1052` plus 3 non-conflicting families.
   - Assert preflight returns one conflict. Resolve as rename to `ABHIT-IST-DD-1052-RESTORED`. Execute.
   - Assert: target now has both the original and the renamed engagement; renamed one has the rename note in `internal_notes` and an `engagement.restored.renamed` audit entry.
4. **Integration test: skip resolution.**
   - Same setup as above. Resolve the conflict as skip.
   - Assert: only the 3 non-conflicting families are added; the conflicting family is absent from the restore.
5. **Security tests.**
   - Wrong passphrase → 400 with generic decryption error message (do not leak which step failed).
   - Zip with `../../etc/passwd` member → rejected before any extraction.
   - Zip with 60 GB of zeros uncompressed → rejected at member-count or stream-size guard, no DoS.
   - Non-zip payload → rejected.
   - Attachment whose declared `mime_type` is `image/png` but whose bytes are not a PNG → rejected during restore.
6. **Streaming verification.**
   - Generate a synthetic dataset producing a ~1 GB bundle. Confirm the export endpoint's response starts streaming within 2 seconds and that Python process RSS does not grow unboundedly during the response.
7. **Regression.** Full existing test suite. Vendor/IR portals, historical-DD import, questionnaire editor, inventory dashboard, Word export, audit log views — all unchanged behaviour.

## On completion

When the implementation is functionally complete and the verification plan above passes:

1. **Update documentation.** Do not create new top-level docs — extend the existing ones.
   - `CLAUDE.md`: add an entry under "Build Phases" recording that full-instance export and restore is now available, **and mark the "Database backup" item under Phase 2/3 as superseded** (this feature replaces it). Reference the four new endpoints (`/api/admin/settings/instance/export`, `.../restore/upload`, `.../restore/execute`, `DELETE .../restore/{session_id}`), the Settings → Backup & Restore tab, and the bundle layout. Tick any Security Checklist items now satisfied.
   - `CLAUDE-questionnaire-versioning.md`: note that live versions travel by id reference in the export bundle while IMPORTED- versions are inlined per-engagement.
   - `README.md`: add a short "Backing up and restoring" section covering: where the tab lives, the passphrase requirement, the conflict-resolution flow on restore, and the bundle layout at a glance.
   - The `.env.example` and any deployment notes: document `BACKUP_DIR` usage for restore sessions if not already covered.

2. **Commit.**
   - One commit, or a small number of focused commits if backend / frontend / docs are cleanly separable. Avoid one mega-commit; avoid one-commit-per-file noise.
   - Follow the existing commit-message style (`git log --oneline -20`): short subject line, descriptive of the change, no ticket prefixes (the repo doesn't use them).
   - Include the project's `Co-Authored-By: ...` footer per the standard commit protocol.
   - **Do not push.** The user pushes to `origin` (github main) and `gitlab` (feature/current branch) themselves on their own cadence.

3. **Do not delete this prompt file.** It stays in `prompts/` as the permanent specification reference. If the implementation diverges from this prompt in any non-trivial way, update the prompt to match before committing — the prompt should always reflect what's actually in the code.
