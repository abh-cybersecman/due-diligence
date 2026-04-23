# Patch to CLAUDE.md — Questionnaire Versioning

Apply these edits to `CLAUDE.md` after creating `CLAUDE-questionnaire-versioning.md`. Keep this patch file in the repo root alongside CLAUDE.md so the relationship is obvious to any future Claude Code session.

---

## Edit 1 — Near the top of CLAUDE.md, just under "Project Overview"

**Add this paragraph** after the "Three user types exist" list:

> ### Companion Documents
>
> - **`CLAUDE-questionnaire-versioning.md`** — governs questionnaire structure, versioning, the admin editor, engagement revisions (R1/R2), and response-rendering rules. If anything in CLAUDE.md conflicts with that document, the addendum wins for those topics.

---

## Edit 2 — "Database Models" section, **Question** entry

**Replace** the existing Question model block with:

```
Question (see CLAUDE-questionnaire-versioning.md for full schema)
- id (UUID PK)
- version_id (UUID FK → questionnaire_versions)
- section_id (UUID FK → questionnaire_sections)
- question_number (Integer — unique within version, not globally)
- question_key (String — stable identifier across versions)
- question_text (Text)
- response_type (Enum: TEXT, SINGLE_CHOICE, MULTI_CHOICE, FILE_UPLOAD)
- allows_other (Boolean — only meaningful for SINGLE_CHOICE / MULTI_CHOICE)
- hint_text (Text, nullable)
- is_required (Boolean)
- order (Integer)

QuestionOption, QuestionnaireSection, QuestionnaireVersion — see addendum.
```

(The `is_ai_addendum` flag is moved from Question to QuestionnaireSection. The `section` String column is replaced by `section_id`.)

---

## Edit 3 — **Engagement** model entry

**Add** these fields to the Engagement model block:

```
- questionnaire_version_id (UUID FK → questionnaire_versions, NOT NULL)
- parent_engagement_id (UUID FK → engagements, nullable)
- revision_number (Integer, default 0)
```

---

## Edit 4 — **Response** model entry

**Add** this field:

```
- other_text (Text, nullable)
```

---

## Edit 5 — "Document Number Generation" section

**Append** after the existing bullets:

- Refreshed engagements use the pattern `{root_doc_number}-R{n}` where `n` is the revision number (1, 2, 3, …). The document-number sequence (MAX+1) ignores `-R*` suffixes — only originals participate in the auto-increment.

---

## Edit 6 — "Questionnaire Seeding" section

**Replace** the entire section with:

> Questionnaire content is managed via versioned tables. Initial seeding happens **once**, inside Alembic migration `0004_questionnaire_versioning.py`, which creates `questionnaire_versions` row `v1.0`, populates sections and questions from the legacy `questions.json` file, and pins all existing engagements to `v1.0`. The `seed/questions.json` file is retained for reference only and is no longer read at runtime.
>
> The previous `lifespan` event in `main.py` that seeded questions on empty-table startup **must be removed**. After migration `0004`, question management is done exclusively through the admin questionnaire editor UI (see addendum).

---

## Edit 7 — "API Route Structure" — `/api/admin/` block

**Add** these routes to the existing list:

```
GET    /questionnaire/versions
GET    /questionnaire/versions/{id}
GET    /questionnaire/draft
POST   /questionnaire/draft/sections
PATCH  /questionnaire/draft/sections/{id}
DELETE /questionnaire/draft/sections/{id}
POST   /questionnaire/draft/questions
PATCH  /questionnaire/draft/questions/{id}
DELETE /questionnaire/draft/questions/{id}
POST   /questionnaire/draft/reorder
POST   /questionnaire/draft/publish                  # Requires password re-confirmation
POST   /questionnaire/draft/discard
GET    /questionnaire/draft/diff
GET    /questionnaire/preview
POST   /engagements/{id}/refresh                     # Requires password re-confirmation
```

---

## Edit 8 — "Frontend Routes" section

**Add**:

```
/due-diligence/admin/questionnaire
/due-diligence/admin/questionnaire/preview
```

---

## Edit 9 — "Build Phases" section

**Add** a new phase block between Phase 2 and Phase 3:

```
### Phase Q — Questionnaire Versioning & Engagement Refresh

See CLAUDE-questionnaire-versioning.md for the full spec. Seven sub-phases Q1–Q7.
Completing Phase Q is a precondition for Phase 3 (AI integration). Phase 3 stubs
already reference engagement.id, which is stable across this work.

- [ ] Q1 — Schema migration + backfill
- [ ] Q2 — Admin editor (read-only)
- [ ] Q3 — Admin editor (write)
- [ ] Q4 — Publish flow + diff
- [ ] Q5 — Version-aware rendering + export updates
- [ ] Q6 — Refresh (R1/R2) flow
- [ ] Q7 — Dashboard grouping + responses revision selector
```

---

## Edit 10 — "Security Checklist" section

**Add** these items:

- [ ] Questionnaire editor endpoints reject writes to non-draft versions (400)
- [ ] Publish and Refresh require bcrypt password re-confirmation
- [ ] `other_text` sanitized via bleach on write
- [ ] `question_key` is server-assigned only, never accepted from request body
- [ ] Migration `0004` includes a working `downgrade()` for rollback

---

That's it. Nothing else in CLAUDE.md needs to change — lifecycle, auth, file security, export styling, WAF notes, etc. are all still accurate.
