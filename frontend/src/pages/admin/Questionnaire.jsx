import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AdminLayout from '../../components/admin/AdminLayout'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const TITLE_BASE = 'Questionnaire editor — ISDD'

function useAdminFetch() {
  const { adminSession } = useAuth()
  return useCallback(
    (path, opts = {}) =>
      fetch(`${BASE_PATH}${path}`, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSession?.accessToken}`,
          ...(opts.headers || {}),
        },
      }),
    [adminSession]
  )
}

const RESPONSE_TYPE_LABELS = {
  TEXT: 'Text',
  SINGLE_CHOICE: 'Single choice',
  MULTI_CHOICE: 'Multi choice',
  FILE_UPLOAD: 'File upload',
}

const CHOICE_TYPES = new Set(['SINGLE_CHOICE', 'MULTI_CHOICE'])

function newId() {
  // Stable, unique client-side key for entities that haven't hit the server.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `new-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

function formatTimestamp(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Server payload → client draft (stamp `_isNew:false` on everything).
function normalizeDraft(serverDraft) {
  return {
    ...serverDraft,
    sections: (serverDraft.sections || []).map((s) => ({
      ...s,
      _isNew: false,
      questions: (s.questions || []).map((q) => ({
        ...q,
        _isNew: false,
        options: (q.options || []).map((o) => ({
          ...o,
          _isNew: false,
        })),
      })),
    })),
  }
}

// ─── Small icons ───────────────────────────────────────────────────────────

function DragHandleIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="5" r="1.6" /><circle cx="15" cy="5" r="1.6" />
      <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="19" r="1.6" /><circle cx="15" cy="19" r="1.6" />
    </svg>
  )
}

function MoreIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

function TrashIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}

export function FileTextIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />
    </svg>
  )
}

// ─── Main component ────────────────────────────────────────────────────────

export default function Questionnaire() {
  const adminFetch = useAdminFetch()
  const [draft, setDraft] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('standard')
  const [activeSectionId, setActiveSectionId] = useState(null)
  const [typeChangePrompt, setTypeChangePrompt] = useState(null)
  const [renumberPrompt, setRenumberPrompt] = useState(false)
  const [renumberNotice, setRenumberNotice] = useState(null)
  const [previewPrompt, setPreviewPrompt] = useState(false)
  const [warningToast, setWarningToast] = useState(null)
  const [successToast, setSuccessToast] = useState(null)

  // Publish modal
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishDiff, setPublishDiff] = useState(null)
  const [publishDiffLoading, setPublishDiffLoading] = useState(false)
  const [publishDiffError, setPublishDiffError] = useState('')
  const [publishChangelog, setPublishChangelog] = useState('')
  const [publishOverrideEnabled, setPublishOverrideEnabled] = useState(false)
  const [publishOverrideLabel, setPublishOverrideLabel] = useState('')
  const [publishPassword, setPublishPassword] = useState('')
  const [publishSubmitting, setPublishSubmitting] = useState(false)
  const [publishError, setPublishError] = useState('')

  // Discard modal
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discardText, setDiscardText] = useState('')
  const [discardSubmitting, setDiscardSubmitting] = useState(false)
  const [discardError, setDiscardError] = useState('')

  // Version history
  const [versions, setVersions] = useState([])
  const [versionsOpen, setVersionsOpen] = useState(false)

  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  const loadDraft = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/questionnaire/draft')
      if (!res.ok) throw new Error('Failed to load draft questionnaire')
      const data = await res.json()
      setDraft(normalizeDraft(data))
      setDirty(false)
      setSavedFlash(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [adminFetch])

  useEffect(() => {
    loadDraft()
  }, [loadDraft])

  const loadVersions = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/questionnaire/versions')
      if (!res.ok) return
      const data = await res.json()
      setVersions(data)
    } catch {
      /* non-critical */
    }
  }, [adminFetch])

  useEffect(() => {
    loadVersions()
  }, [loadVersions])

  // Any local mutation flows through this — sets the draft and marks dirty.
  const mutate = useCallback((producer) => {
    setDraft((prev) => (prev ? producer(prev) : prev))
    setDirty(true)
    setSavedFlash(false)
    setSaveError('')
  }, [])

  // ── Section mutations (local only) ─────────────────────────────────────

  const addSection = useCallback((isAI) => {
    const id = newId()
    mutate((prev) => {
      const order = prev.sections.length
      return {
        ...prev,
        sections: [
          ...prev.sections,
          {
            id,
            _isNew: true,
            version_id: prev.id,
            title: 'New section',
            order,
            is_ai_addendum: isAI,
            questions: [],
          },
        ],
      }
    })
    setTab(isAI ? 'ai' : 'standard')
    setActiveSectionId(id)
  }, [mutate])

  const renameSection = useCallback((sectionId, title) => {
    mutate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId ? { ...s, title } : s
      ),
    }))
  }, [mutate])

  const toggleSectionAI = useCallback((sectionId) => {
    mutate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId ? { ...s, is_ai_addendum: !s.is_ai_addendum } : s
      ),
    }))
  }, [mutate])

  const deleteSection = useCallback((sectionId) => {
    mutate((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.id !== sectionId),
    }))
  }, [mutate])

  const reorderSectionsInTab = useCallback((newOrderedSections) => {
    // newOrderedSections is the new order within the current tab's subset.
    // Reassign `order` contiguously to the items in that subset, preserving
    // the relative order of sections outside the subset by interleaving.
    mutate((prev) => {
      const subsetIds = new Set(newOrderedSections.map((s) => s.id))
      const subsetOrder = new Map(newOrderedSections.map((s, idx) => [s.id, idx]))
      // Stable ordering: sections in the subset follow their new order;
      // sections outside the subset follow their existing order.
      const remaining = prev.sections
        .filter((s) => !subsetIds.has(s.id))
        .slice()
        .sort((a, b) => a.order - b.order)
      const subset = newOrderedSections.slice()
      // Merge subset at their original global positions (by picking subset
      // rank in the filtered list and walking through).
      const merged = []
      // Walk through the original order; when we hit a subset member, emit the
      // next subset item; otherwise emit the next remaining item.
      const subsetIter = subset[Symbol.iterator]()
      const remainingIter = remaining[Symbol.iterator]()
      for (const orig of prev.sections.slice().sort((a, b) => a.order - b.order)) {
        if (subsetIds.has(orig.id)) {
          merged.push(subsetIter.next().value)
        } else {
          merged.push(remainingIter.next().value)
        }
      }
      return {
        ...prev,
        sections: merged.map((s, idx) => ({ ...s, order: idx })),
      }
    })
  }, [mutate])

  // ── Question mutations (local only) ────────────────────────────────────

  const addQuestion = useCallback((sectionId) => {
    const id = newId()
    mutate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        const questions = s.questions || []
        return {
          ...s,
          questions: [
            ...questions,
            {
              id,
              _isNew: true,
              version_id: prev.id,
              section_id: sectionId,
              question_number: null, // assigned by server on save
              question_key: '(new)',
              question_text: 'New question',
              response_type: 'TEXT',
              is_required: true,
              hint_text: null,
              allows_other: false,
              order: questions.length,
              options: [],
            },
          ],
        }
      }),
    }))
  }, [mutate])

  const updateQuestion = useCallback((questionId, patch) => {
    mutate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => ({
        ...s,
        questions: (s.questions || []).map((q) =>
          q.id === questionId ? { ...q, ...patch } : q
        ),
      })),
    }))
  }, [mutate])

  const deleteQuestion = useCallback((questionId) => {
    mutate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => ({
        ...s,
        questions: (s.questions || []).filter((q) => q.id !== questionId),
      })),
    }))
  }, [mutate])

  const reorderQuestionsInSection = useCallback((sectionId, orderedQuestions) => {
    mutate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        return {
          ...s,
          questions: orderedQuestions.map((q, idx) => ({ ...q, order: idx })),
        }
      }),
    }))
  }, [mutate])

  // ── Tab / active section derived state ─────────────────────────────────

  const sectionsForTab = useMemo(() => {
    if (!draft) return []
    const isAI = tab === 'ai'
    return draft.sections
      .filter((s) => !!s.is_ai_addendum === isAI)
      .slice()
      .sort((a, b) => a.order - b.order)
  }, [draft, tab])

  useEffect(() => {
    if (sectionsForTab.length === 0) {
      setActiveSectionId(null)
      return
    }
    const stillExists = sectionsForTab.some((s) => s.id === activeSectionId)
    if (!stillExists) setActiveSectionId(sectionsForTab[0].id)
  }, [sectionsForTab, activeSectionId])

  const activeSection = useMemo(
    () => sectionsForTab.find((s) => s.id === activeSectionId) || null,
    [sectionsForTab, activeSectionId]
  )

  // ── Save ───────────────────────────────────────────────────────────────

  const saveDraft = useCallback(async () => {
    if (!dirtyRef.current || !draft) return
    setSaving(true)
    setSaveError('')
    try {
      const payload = {
        sections: draft.sections
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((s) => ({
            id: s._isNew ? null : s.id,
            title: s.title,
            is_ai_addendum: s.is_ai_addendum,
            questions: (s.questions || [])
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((q) => ({
                id: q._isNew ? null : q.id,
                question_text: q.question_text,
                response_type: q.response_type,
                is_required: q.is_required,
                allows_other: q.allows_other,
                hint_text: q.hint_text,
                options: (q.options || [])
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((o) => ({
                    id: o._isNew ? null : o.id,
                    label: o.label,
                  })),
              })),
          })),
      }

      const res = await adminFetch('/api/admin/questionnaire/draft/save', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || 'Save failed')
      }
      const data = await res.json()
      setDraft(normalizeDraft(data.draft))
      setDirty(false)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
      if (data.warnings && data.warnings.length) {
        setWarningToast(data.warnings.join(' · '))
      }
    } catch (err) {
      setSaveError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [adminFetch, draft])

  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft

  // ── beforeunload guard ─────────────────────────────────────────────────

  useEffect(() => {
    function handler(e) {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // ── document.title dirty marker ────────────────────────────────────────

  useEffect(() => {
    const previous = document.title
    document.title = dirty ? `• ${TITLE_BASE}` : TITLE_BASE
    return () => { document.title = previous }
  }, [dirty])

  // ── Cmd/Ctrl+S ─────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (dirtyRef.current) saveDraftRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Response-type confirmation (client-side flag) ──────────────────────

  function requestResponseTypeChange(question, newType, commit) {
    setTypeChangePrompt({ question, newType, commit })
  }

  function openPreview() {
    window.open(`${BASE_PATH}/admin/questionnaire/preview`, '_blank', 'noopener,noreferrer')
  }

  function handlePreviewClick() {
    if (dirty) {
      setPreviewPrompt(true)
    } else {
      openPreview()
    }
  }

  async function runRenumber() {
    try {
      const res = await adminFetch('/api/admin/questionnaire/draft/renumber', {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Renumber failed')
      const data = await res.json()
      await loadDraft()
      const n = data.changed_count ?? 0
      setRenumberNotice(
        n === 0
          ? 'Questions already in order — nothing to renumber.'
          : `Renumbered ${n} question${n === 1 ? '' : 's'}.`
      )
    } catch (err) {
      setRenumberNotice(err.message || 'Renumber failed')
    }
  }

  // ── Publish ────────────────────────────────────────────────────────────

  async function openPublish() {
    if (dirty) return
    setPublishOpen(true)
    setPublishDiff(null)
    setPublishDiffError('')
    setPublishDiffLoading(true)
    setPublishChangelog('')
    setPublishOverrideEnabled(false)
    setPublishOverrideLabel('')
    setPublishPassword('')
    setPublishError('')
    try {
      const res = await adminFetch('/api/admin/questionnaire/draft/diff')
      if (!res.ok) throw new Error('Failed to load diff')
      const data = await res.json()
      setPublishDiff(data)
    } catch (err) {
      setPublishDiffError(err.message || 'Failed to load diff')
    } finally {
      setPublishDiffLoading(false)
    }
  }

  function closePublish() {
    if (publishSubmitting) return
    setPublishOpen(false)
  }

  async function submitPublish() {
    const trimmed = publishChangelog.trim()
    if (trimmed.length < 20) {
      setPublishError('Changelog must be at least 20 characters')
      return
    }
    if (!publishPassword) {
      setPublishError('Password is required')
      return
    }
    if (publishOverrideEnabled && !/^v\d+\.\d+$/.test(publishOverrideLabel.trim())) {
      setPublishError('Version label must match pattern vMAJOR.MINOR (e.g. v2.0)')
      return
    }

    setPublishSubmitting(true)
    setPublishError('')
    try {
      const body = {
        changelog: trimmed,
        password: publishPassword,
      }
      if (publishOverrideEnabled) {
        body.version_label = publishOverrideLabel.trim()
      }
      const res = await adminFetch('/api/admin/questionnaire/draft/publish', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        if (res.status === 403) {
          throw new Error('Incorrect password')
        }
        throw new Error(errBody.detail || 'Publish failed')
      }
      const data = await res.json()
      setPublishOpen(false)
      await loadDraft()
      await loadVersions()
      setSuccessToast(`Published ${data.new_version.version_label}`)
    } catch (err) {
      setPublishError(err.message || 'Publish failed')
    } finally {
      setPublishSubmitting(false)
    }
  }

  // ── Discard ────────────────────────────────────────────────────────────

  function openDiscard() {
    setDiscardOpen(true)
    setDiscardText('')
    setDiscardError('')
  }

  function closeDiscard() {
    if (discardSubmitting) return
    setDiscardOpen(false)
  }

  async function submitDiscard() {
    if (discardText !== 'DISCARD') return
    setDiscardSubmitting(true)
    setDiscardError('')
    try {
      const res = await adminFetch('/api/admin/questionnaire/draft/discard', {
        method: 'POST',
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.detail || 'Discard failed')
      }
      await loadDraft()
      setDiscardOpen(false)
      setSuccessToast('Draft discarded — restored from current published version.')
    } catch (err) {
      setDiscardError(err.message || 'Discard failed')
    } finally {
      setDiscardSubmitting(false)
    }
  }

  const lastEdited = draft ? (draft.updated_at || draft.created_at) : null
  const currentVersion = useMemo(
    () => versions.find((v) => v.is_current) || null,
    [versions]
  )

  return (
    <AdminLayout>
      <div style={s.headerRow}>
        <div>
          <h1 style={s.pageTitle}>Questionnaire</h1>
          <p style={s.pageSub}>
            Draft version of the vendor security questionnaire. Publishing
            arrives in a later phase — until then changes live in the draft.
          </p>
        </div>
      </div>

      {loading ? (
        <div style={s.loading}>Loading draft…</div>
      ) : error ? (
        <div style={s.errorBanner}>{error}</div>
      ) : !draft ? (
        <div style={s.loading}>No draft available.</div>
      ) : (
        <div style={s.grid} className="fade-in">
          {/* ── Sections column ─────────────────────────────────────────── */}
          <aside style={s.leftCol} className="card">
            <div style={s.tabs}>
              <button
                className={`tab-btn${tab === 'standard' ? ' tab-btn--active' : ''}`}
                style={s.tabBtn}
                onClick={() => setTab('standard')}
              >
                Standard
              </button>
              <button
                className={`tab-btn${tab === 'ai' ? ' tab-btn--active' : ''}`}
                style={s.tabBtn}
                onClick={() => setTab('ai')}
              >
                AI Addendum
              </button>
            </div>

            <SectionList
              sections={sectionsForTab}
              activeSectionId={activeSectionId}
              onSelect={setActiveSectionId}
              onReorder={reorderSectionsInTab}
              onRename={renameSection}
              onToggleAI={toggleSectionAI}
              onDelete={deleteSection}
            />

            <div style={s.addSectionRow}>
              <button
                className="btn btn-secondary"
                style={{ width: '100%' }}
                onClick={() => addSection(tab === 'ai')}
              >
                + Add Section
              </button>
            </div>
          </aside>

          {/* ── Questions column ────────────────────────────────────────── */}
          <main style={s.middleCol}>
            {!activeSection ? (
              <div className="card" style={s.emptyPanel}>
                Select a section to view its questions, or add a new one.
              </div>
            ) : (
              <SectionEditor
                section={activeSection}
                onReorderQuestions={(ordered) =>
                  reorderQuestionsInSection(activeSection.id, ordered)
                }
                onAddQuestion={() => addQuestion(activeSection.id)}
                onUpdateQuestion={updateQuestion}
                onDeleteQuestion={deleteQuestion}
                onRequestTypeChange={requestResponseTypeChange}
              />
            )}
          </main>

          {/* ── Right metadata panel ────────────────────────────────────── */}
          <aside style={s.rightCol} className="card">
            <div style={s.metaSection}>
              <div style={s.metaLabel}>DRAFT VERSION</div>
              <div style={s.metaVersionRow}>
                <span style={s.metaVersionLabel}>{draft.version_label}</span>
                <span className="badge" style={s.draftBadge}>Draft</span>
                {dirty && (
                  <span className="badge" style={s.dirtyChip} title="Unsaved changes">
                    Unsaved changes
                  </span>
                )}
              </div>
              <div style={s.metaHint}>
                Changes apply when the draft is published.
              </div>
            </div>

            <div style={s.metaDivider} />

            <div style={s.metaSection}>
              <div style={s.metaLabel}>LAST EDITED</div>
              <div style={s.metaValue}>{formatTimestamp(lastEdited)}</div>
            </div>

            <div style={s.metaDivider} />

            <div style={s.metaSection}>
              <button
                className="btn btn-secondary"
                style={s.metaAction}
                onClick={handlePreviewClick}
              >
                Preview as vendor
              </button>
            </div>

            <div style={s.metaDivider} />

            <div style={s.metaSection}>
              <button
                className="btn btn-primary"
                style={s.metaAction}
                onClick={saveDraft}
                disabled={!dirty || saving}
                title={
                  !dirty && !savedFlash
                    ? 'No unsaved changes'
                    : dirty
                      ? 'Save draft (Ctrl/Cmd+S)'
                      : undefined
                }
              >
                {saving
                  ? 'Saving…'
                  : savedFlash
                    ? 'Saved ✓'
                    : 'Save draft'}
              </button>
              {saveError && (
                <div style={s.saveErrorText}>{saveError}</div>
              )}
            </div>

            <div style={s.metaDivider} />

            <div style={s.metaSection}>
              <button
                className="btn btn-secondary"
                style={s.metaAction}
                onClick={() => setRenumberPrompt(true)}
                disabled={dirty}
                title={dirty ? 'Save draft before renumbering' : undefined}
              >
                Renumber questions
              </button>
            </div>

            <div style={s.metaDivider} />

            <div style={s.metaSection}>
              <div style={s.metaLabel}>ACTIONS</div>
              <div style={s.metaActions}>
                <button
                  className="btn btn-secondary"
                  style={s.metaAction}
                  onClick={openDiscard}
                >
                  Discard draft
                </button>
                <button
                  className="btn btn-primary"
                  style={s.metaAction}
                  onClick={openPublish}
                  disabled={dirty}
                  title={
                    dirty
                      ? 'Save your changes before publishing.'
                      : 'Publish the draft as a new version'
                  }
                >
                  Publish
                </button>
              </div>
            </div>

            <div style={s.metaDivider} />

            <VersionHistoryPanel
              versions={versions}
              open={versionsOpen}
              onToggle={() => setVersionsOpen((v) => !v)}
            />
          </aside>
        </div>
      )}

      {typeChangePrompt && (
        <ConfirmModal
          title="Change response type?"
          body={
            <>
              Changing the response type from{' '}
              <strong>{RESPONSE_TYPE_LABELS[typeChangePrompt.question.response_type]}</strong>{' '}
              to <strong>{RESPONSE_TYPE_LABELS[typeChangePrompt.newType]}</strong> will
              treat this as a new question for refresh matching — a new key will be minted
              when you save.
              Continue?
            </>
          }
          confirmLabel="Change type"
          onConfirm={() => {
            typeChangePrompt.commit()
            setTypeChangePrompt(null)
          }}
          onCancel={() => {
            typeChangePrompt.commit(null) // signal revert
            setTypeChangePrompt(null)
          }}
        />
      )}

      {renumberPrompt && (
        <ConfirmModal
          title="Renumber questions?"
          body={
            <>
              Assign sequential question numbers (1, 2, 3…) to every question
              in the draft based on current order. Existing numbers will be
              overwritten. Continue?
            </>
          }
          confirmLabel="Renumber"
          onConfirm={() => {
            setRenumberPrompt(false)
            runRenumber()
          }}
          onCancel={() => setRenumberPrompt(false)}
        />
      )}

      {renumberNotice && (
        <Toast
          message={renumberNotice}
          onDismiss={() => setRenumberNotice(null)}
        />
      )}

      {previewPrompt && (
        <PreviewDirtyPrompt
          onSaveAndPreview={async () => {
            setPreviewPrompt(false)
            await saveDraft()
            openPreview()
          }}
          onPreviewAnyway={() => {
            setPreviewPrompt(false)
            openPreview()
          }}
          onCancel={() => setPreviewPrompt(false)}
        />
      )}

      {warningToast && (
        <Toast
          message={warningToast}
          onDismiss={() => setWarningToast(null)}
        />
      )}

      {successToast && (
        <Toast
          message={successToast}
          onDismiss={() => setSuccessToast(null)}
        />
      )}

      {publishOpen && (
        <PublishModal
          diff={publishDiff}
          diffLoading={publishDiffLoading}
          diffError={publishDiffError}
          changelog={publishChangelog}
          onChangeChangelog={setPublishChangelog}
          overrideEnabled={publishOverrideEnabled}
          onToggleOverride={(v) => {
            setPublishOverrideEnabled(v)
            if (!v) setPublishOverrideLabel('')
          }}
          overrideLabel={publishOverrideLabel}
          onChangeOverrideLabel={setPublishOverrideLabel}
          password={publishPassword}
          onChangePassword={setPublishPassword}
          submitting={publishSubmitting}
          error={publishError}
          onCancel={closePublish}
          onSubmit={submitPublish}
        />
      )}

      {discardOpen && (
        <DiscardModal
          currentVersionLabel={currentVersion?.version_label || 'current'}
          text={discardText}
          onChangeText={setDiscardText}
          submitting={discardSubmitting}
          error={discardError}
          onCancel={closeDiscard}
          onConfirm={submitDiscard}
        />
      )}
    </AdminLayout>
  )
}

// ─── Section list (sortable) ───────────────────────────────────────────────

function SectionList({ sections, activeSectionId, onSelect, onReorder, onRename, onToggleAI, onDelete }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = sections.findIndex((s) => s.id === active.id)
    const newIndex = sections.findIndex((s) => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(sections, oldIndex, newIndex)
    onReorder(reordered)
  }

  return (
    <div style={s.sectionList}>
      {sections.length === 0 ? (
        <div style={s.emptyHint}>No sections yet.</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {sections.map((section) => (
              <SortableSectionItem
                key={section.id}
                section={section}
                isActive={section.id === activeSectionId}
                onSelect={() => onSelect(section.id)}
                onRename={(title) => onRename(section.id, title)}
                onToggleAI={() => onToggleAI(section.id)}
                onDelete={() => {
                  const count = section.questions?.length ?? 0
                  const msg = count > 0
                    ? `Delete section "${section.title}"? This will also delete ${count} question${count === 1 ? '' : 's'}.`
                    : `Delete section "${section.title}"?`
                  if (window.confirm(msg)) onDelete(section.id)
                }}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

function SortableSectionItem({ section, isActive, onSelect, onRename, onToggleAI, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(section.title)
  const [menuPos, setMenuPos] = useState(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => { setTitle(section.title) }, [section.title])

  const closeMenu = useCallback(() => setMenuPos(null), [])

  function toggleMenu() {
    if (menuPos) {
      closeMenu()
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPos({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }

  useEffect(() => {
    if (!menuPos) return
    function onDocMouseDown(e) {
      if (menuRef.current?.contains(e.target)) return
      if (triggerRef.current?.contains(e.target)) return
      closeMenu()
    }
    function onKey(e) { if (e.key === 'Escape') closeMenu() }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    // capture=true so scrolls inside nested scrollers (e.g. the sections list)
    // are still observed — scroll events don't bubble.
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menuPos, closeMenu])

  function commit() {
    const trimmed = title.trim()
    if (trimmed && trimmed !== section.title) onRename(trimmed)
    else setTitle(section.title)
    setEditing(false)
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }

  const count = section.questions?.length ?? 0

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, ...s.sectionItem, ...(isActive ? s.sectionItemActive : {}) }}
    >
      <button
        {...attributes}
        {...listeners}
        style={s.dragHandleBtn}
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
      >
        <DragHandleIcon />
      </button>

      <button style={s.sectionItemBody} onClick={onSelect}>
        {editing ? (
          <input
            autoFocus
            className="input"
            style={s.sectionRenameInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              else if (e.key === 'Escape') { setTitle(section.title); setEditing(false) }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            style={s.sectionItemTitle}
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
            title="Double-click to rename"
          >
            {section.title}
          </span>
        )}
        <span style={s.sectionItemCount}>
          {count} {count === 1 ? 'question' : 'questions'}
        </span>
      </button>

      <button
        ref={triggerRef}
        style={s.iconBtn}
        onClick={(e) => { e.stopPropagation(); toggleMenu() }}
        aria-label="Section menu"
      >
        <MoreIcon />
      </button>
      {menuPos && createPortal(
        <div
          ref={menuRef}
          style={{ ...s.menu, top: menuPos.top, right: menuPos.right }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="menu-item" onClick={() => { setEditing(true); closeMenu() }}>
            Rename
          </button>
          <button className="menu-item" onClick={() => { onToggleAI(); closeMenu() }}>
            {section.is_ai_addendum ? 'Move to Standard' : 'Move to AI Addendum'}
          </button>
          <button
            className="menu-item menu-item--danger"
            onClick={() => { onDelete(); closeMenu() }}
          >
            Delete section
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}

// ─── Section editor (middle column) ───────────────────────────────────────

function SectionEditor({
  section,
  onReorderQuestions,
  onAddQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onRequestTypeChange,
}) {
  const [expandedId, setExpandedId] = useState(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const questions = useMemo(
    () => (section.questions || []).slice().sort((a, b) => a.order - b.order),
    [section.questions]
  )

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = questions.findIndex((q) => q.id === active.id)
    const newIndex = questions.findIndex((q) => q.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorderQuestions(arrayMove(questions, oldIndex, newIndex))
  }

  return (
    <>
      <div style={s.sectionHeader}>
        <div style={s.sectionTitleGroup}>
          {section.is_ai_addendum && (
            <span className="badge" style={{ background: 'var(--blue-subtle)', color: 'var(--blue)' }}>
              AI Addendum
            </span>
          )}
          <h2 style={s.sectionTitle}>{section.title}</h2>
        </div>
        <span style={s.sectionCount}>
          {questions.length} {questions.length === 1 ? 'question' : 'questions'}
        </span>
      </div>

      <div style={s.questionList}>
        {questions.length === 0 ? (
          <div className="card" style={s.emptyPanel}>
            No questions yet. Click "+ Add Question" below.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
              {questions.map((q) => (
                <SortableQuestionCard
                  key={q.id}
                  question={q}
                  expanded={expandedId === q.id}
                  onToggle={() => setExpandedId((id) => (id === q.id ? null : q.id))}
                  onUpdate={(patch) => onUpdateQuestion(q.id, patch)}
                  onDelete={() => {
                    const label = q.question_number ?? 'new'
                    if (window.confirm(`Delete question Q${label}?`)) onDeleteQuestion(q.id)
                  }}
                  onRequestTypeChange={onRequestTypeChange}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}

        <button
          className="btn btn-secondary"
          style={{ marginTop: 4 }}
          onClick={onAddQuestion}
        >
          + Add Question
        </button>
      </div>
    </>
  )
}

// ─── Question card (sortable, collapsed/expanded) ──────────────────────────

function SortableQuestionCard(props) {
  const { question } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: question.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      <QuestionCard
        {...props}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </div>
  )
}

function QuestionCard({
  question,
  expanded,
  onToggle,
  onUpdate,
  onDelete,
  onRequestTypeChange,
  dragAttributes,
  dragListeners,
}) {
  const numberLabel = question.question_number ?? '—'

  if (!expanded) {
    return (
      <div className="card" style={s.questionCard} onClick={onToggle}>
        <div style={s.questionHeader}>
          <button
            {...dragAttributes}
            {...dragListeners}
            style={s.dragHandleBtn}
            onClick={(e) => e.stopPropagation()}
            aria-label="Drag to reorder"
          >
            <DragHandleIcon />
          </button>
          <span style={s.questionNumber}>Q{numberLabel}</span>
          <span style={s.questionText}>{question.question_text}</span>
        </div>
        <div style={s.questionMeta}>
          <span className="badge" style={s.typeBadge}>
            {RESPONSE_TYPE_LABELS[question.response_type] || question.response_type}
          </span>
          <span
            className="badge"
            style={question.is_required ? s.requiredBadge : s.optionalBadge}
          >
            {question.is_required ? 'Required' : 'Optional'}
          </span>
          {question.allows_other && (
            <span className="badge" style={s.otherBadge}>Allows "Other"</span>
          )}
          {question._isNew && (
            <span className="badge" style={s.newBadge}>New</span>
          )}
          {question.options && question.options.length > 0 && (
            <span style={s.optionCount}>
              {question.options.length} {question.options.length === 1 ? 'option' : 'options'}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <QuestionEditForm
      key={question.id}
      question={question}
      onCollapse={onToggle}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onRequestTypeChange={onRequestTypeChange}
      dragAttributes={dragAttributes}
      dragListeners={dragListeners}
    />
  )
}

function QuestionEditForm({
  question,
  onCollapse,
  onUpdate,
  onDelete,
  onRequestTypeChange,
  dragAttributes,
  dragListeners,
}) {
  const [showHint, setShowHint] = useState(Boolean(question.hint_text))

  // Response-type change — confirm first, then apply.
  function handleResponseTypeChange(newType) {
    onRequestTypeChange(question, newType, (confirmedType) => {
      if (confirmedType === null) return
      const isChoice = CHOICE_TYPES.has(newType)
      onUpdate({
        response_type: newType,
        allows_other: isChoice ? question.allows_other : false,
        options: isChoice ? question.options : [],
      })
    })
  }

  function handleOptionChange(idx, label) {
    onUpdate({
      options: question.options.map((o, i) => (i === idx ? { ...o, label } : o)),
    })
  }

  function handleAddOption() {
    const len = question.options?.length ?? 0
    onUpdate({
      options: [
        ...(question.options || []),
        { id: newId(), _isNew: true, label: `Option ${len + 1}`, order: len },
      ],
    })
  }

  function handleDeleteOption(idx) {
    onUpdate({
      options: question.options
        .filter((_, i) => i !== idx)
        .map((o, i) => ({ ...o, order: i })),
    })
  }

  function handleOptionDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = question.options.findIndex((o) => o.id === active.id)
    const newIndex = question.options.findIndex((o) => o.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(question.options, oldIndex, newIndex).map(
      (o, i) => ({ ...o, order: i })
    )
    onUpdate({ options: reordered })
  }

  const isChoice = CHOICE_TYPES.has(question.response_type)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const numberLabel = question.question_number ?? '—'

  return (
    <div className="card" style={s.editCard}>
      <div style={s.editHeader}>
        <button
          {...dragAttributes}
          {...dragListeners}
          style={s.dragHandleBtn}
          aria-label="Drag to reorder"
        >
          <DragHandleIcon />
        </button>
        <span style={s.questionNumber}>Q{numberLabel}</span>
        <span style={s.questionKeyLabel}>Key:</span>
        <span style={s.questionKey}>{question.question_key}</span>
        {question._isNew && (
          <span className="badge" style={s.newBadge}>New</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary" onClick={onCollapse}>Collapse</button>
          <button
            className="btn"
            style={s.deleteBtn}
            onClick={onDelete}
            aria-label="Delete question"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <div style={s.fieldBlock}>
        <label style={s.fieldLabel}>Question text</label>
        <textarea
          className="input"
          style={s.textarea}
          value={question.question_text}
          onChange={(e) => onUpdate({ question_text: e.target.value })}
        />
      </div>

      <div style={s.fieldRow}>
        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Response type</label>
          <select
            className="input"
            value={question.response_type}
            onChange={(e) => {
              if (e.target.value !== question.response_type) {
                handleResponseTypeChange(e.target.value)
              }
            }}
          >
            <option value="TEXT">Text</option>
            <option value="SINGLE_CHOICE">Single choice</option>
            <option value="MULTI_CHOICE">Multi choice</option>
            <option value="FILE_UPLOAD">File upload</option>
          </select>
        </div>
        <label style={{ ...s.fieldLabel, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 26 }}>
          <input
            type="checkbox"
            checked={question.is_required}
            onChange={(e) => onUpdate({ is_required: e.target.checked })}
          />
          Required
        </label>
      </div>

      <div style={s.fieldBlock}>
        {showHint || question.hint_text ? (
          <>
            <label style={s.fieldLabel}>Hint text</label>
            <textarea
              className="input"
              style={s.hintArea}
              placeholder="Optional — shown below the question"
              value={question.hint_text || ''}
              onChange={(e) => onUpdate({ hint_text: e.target.value || null })}
            />
          </>
        ) : (
          <button
            type="button"
            style={s.linkBtn}
            onClick={() => setShowHint(true)}
          >
            + Add hint
          </button>
        )}
      </div>

      {isChoice && (
        <div style={s.fieldBlock}>
          <label style={s.fieldLabel}>Options</label>
          {(question.options || []).length === 0 ? (
            <div style={s.emptyOptions}>No options yet.</div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleOptionDragEnd}>
              <SortableContext
                items={(question.options || []).map((o) => o.id)}
                strategy={verticalListSortingStrategy}
              >
                <div style={s.optionList}>
                  {question.options.map((opt, idx) => (
                    <SortableOptionRow
                      key={opt.id}
                      option={opt}
                      onChange={(label) => handleOptionChange(idx, label)}
                      onDelete={() => handleDeleteOption(idx)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: 6 }}
            onClick={handleAddOption}
          >
            + Add option
          </button>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={question.allows_other}
              onChange={(e) => onUpdate({ allows_other: e.target.checked })}
            />
            Allow "Other" response
          </label>
        </div>
      )}
    </div>
  )
}

function SortableOptionRow({ option, onChange, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }
  return (
    <div ref={setNodeRef} style={{ ...style, ...s.optionRow }}>
      <button
        {...attributes}
        {...listeners}
        style={s.dragHandleBtn}
        aria-label="Drag to reorder option"
      >
        <DragHandleIcon />
      </button>
      <input
        className="input"
        style={{ flex: 1 }}
        value={option.label}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        className="btn"
        style={s.deleteBtn}
        onClick={onDelete}
        aria-label="Delete option"
      >
        <TrashIcon />
      </button>
    </div>
  )
}

// ─── Confirm / prompt modals ───────────────────────────────────────────────

function ConfirmModal({ title, body, confirmLabel, onConfirm, onCancel }) {
  return (
    <div style={s.modalOverlay} onClick={onCancel}>
      <div className="card" style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={s.modalTitle}>{title}</h3>
        <div style={s.modalBody}>{body}</div>
        <div style={s.modalActions}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function PreviewDirtyPrompt({ onSaveAndPreview, onPreviewAnyway, onCancel }) {
  return (
    <div style={s.modalOverlay} onClick={onCancel}>
      <div className="card" style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={s.modalTitle}>Unsaved changes</h3>
        <div style={s.modalBody}>
          You have unsaved changes. Preview shows the last saved state.
          Save draft first to preview your new changes.
        </div>
        <div style={s.modalActions}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-secondary" onClick={onPreviewAnyway}>
            Preview saved state anyway
          </button>
          <button className="btn btn-primary" onClick={onSaveAndPreview}>
            Save and preview
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Publish modal ─────────────────────────────────────────────────────────

function PublishModal({
  diff,
  diffLoading,
  diffError,
  changelog,
  onChangeChangelog,
  overrideEnabled,
  onToggleOverride,
  overrideLabel,
  onChangeOverrideLabel,
  password,
  onChangePassword,
  submitting,
  error,
  onCancel,
  onSubmit,
}) {
  const [sectionsOpen, setSectionsOpen] = useState(true)
  const [addedOpen, setAddedOpen] = useState(true)
  const [removedOpen, setRemovedOpen] = useState(true)
  const [editedOpen, setEditedOpen] = useState(true)

  const charCount = changelog.trim().length
  const changelogValid = charCount >= 20
  const passwordValid = password.length > 0
  const overrideValid =
    !overrideEnabled || /^v\d+\.\d+$/.test(overrideLabel.trim())
  const canSubmit =
    !submitting && changelogValid && passwordValid && overrideValid && diff

  const hasSectionChanges =
    diff &&
    ((diff.sections?.added?.length || 0) +
      (diff.sections?.removed?.length || 0) +
      (diff.sections?.renamed?.length || 0) >
      0)

  const questionsAdded = diff?.questions?.added || []
  const questionsRemoved = diff?.questions?.removed || []
  const questionsEdited = diff?.questions?.edited || []
  const unchangedCount = diff?.questions?.unchanged_count ?? 0

  return (
    <div style={s.modalOverlay} onClick={onCancel}>
      <div
        className="card"
        style={s.publishModalCard}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={s.publishHeader}>
          <h3 style={s.modalTitle}>Publish draft</h3>
          {diff && (
            <div style={s.publishVersionStrip}>
              <span style={s.publishVersionFrom}>
                {diff.from_version_label || '—'}
              </span>
              <span style={s.publishVersionArrow}>→</span>
              <span style={s.publishVersionTo}>
                {overrideEnabled && overrideValid && overrideLabel.trim()
                  ? overrideLabel.trim()
                  : diff.to_version_label}
              </span>
            </div>
          )}
        </div>

        <div style={s.publishBody}>
          {diffLoading ? (
            <div style={s.loading}>Computing diff…</div>
          ) : diffError ? (
            <div style={s.errorBanner}>{diffError}</div>
          ) : !diff ? null : (
            <>
              {hasSectionChanges && (
                <CollapsibleBlock
                  title={`Section changes (${(diff.sections.added?.length || 0) +
                    (diff.sections.removed?.length || 0) +
                    (diff.sections.renamed?.length || 0)})`}
                  open={sectionsOpen}
                  onToggle={() => setSectionsOpen((v) => !v)}
                >
                  <div style={s.diffSectionBlock}>
                    {(diff.sections.added || []).map((sx, i) => (
                      <div key={`sa-${i}`} style={s.diffSectionRow}>
                        <span className="badge" style={s.diffBadgeAdded}>Added</span>
                        <span style={s.diffSectionTitle}>{sx.title}</span>
                        {sx.is_ai_addendum && (
                          <span className="badge" style={s.otherBadge}>AI Addendum</span>
                        )}
                      </div>
                    ))}
                    {(diff.sections.removed || []).map((sx, i) => (
                      <div key={`sr-${i}`} style={s.diffSectionRow}>
                        <span className="badge" style={s.diffBadgeRemoved}>Removed</span>
                        <span style={s.diffSectionTitle}>{sx.title}</span>
                      </div>
                    ))}
                    {(diff.sections.renamed || []).map((sx, i) => (
                      <div key={`sn-${i}`} style={s.diffSectionRow}>
                        <span className="badge" style={s.diffBadgeEdited}>Renamed</span>
                        <span style={s.diffSectionTitle}>
                          <span style={s.diffBefore}>{sx.before}</span>
                          <span style={s.diffArrow}> → </span>
                          <span style={s.diffAfter}>{sx.after}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </CollapsibleBlock>
              )}

              <CollapsibleBlock
                title={`Added questions (${questionsAdded.length})`}
                open={addedOpen}
                onToggle={() => setAddedOpen((v) => !v)}
                empty={questionsAdded.length === 0}
              >
                {questionsAdded.map((q) => (
                  <div key={q.question_key} style={s.diffQuestionCard}>
                    <div style={s.diffQuestionMeta}>
                      <span className="badge" style={s.diffBadgeAdded}>Added</span>
                      <span style={s.diffSectionPath}>{q.section_title}</span>
                      <span className="badge" style={s.typeBadge}>
                        {RESPONSE_TYPE_LABELS[q.response_type] || q.response_type}
                      </span>
                      <span
                        className="badge"
                        style={q.is_required ? s.requiredBadge : s.optionalBadge}
                      >
                        {q.is_required ? 'Required' : 'Optional'}
                      </span>
                    </div>
                    <div style={s.diffQuestionText}>{q.question_text}</div>
                  </div>
                ))}
              </CollapsibleBlock>

              <CollapsibleBlock
                title={`Removed questions (${questionsRemoved.length})`}
                open={removedOpen}
                onToggle={() => setRemovedOpen((v) => !v)}
                empty={questionsRemoved.length === 0}
              >
                {questionsRemoved.map((q) => (
                  <div key={q.question_key} style={s.diffQuestionCard}>
                    <div style={s.diffQuestionMeta}>
                      <span className="badge" style={s.diffBadgeRemoved}>Removed</span>
                      <span style={s.diffSectionPath}>{q.section_title}</span>
                    </div>
                    <div style={s.diffQuestionText}>{q.question_text}</div>
                  </div>
                ))}
              </CollapsibleBlock>

              <CollapsibleBlock
                title={`Edited questions (${questionsEdited.length})`}
                open={editedOpen}
                onToggle={() => setEditedOpen((v) => !v)}
                empty={questionsEdited.length === 0}
              >
                {questionsEdited.map((q) => (
                  <EditedQuestionRow key={q.question_key} entry={q} />
                ))}
              </CollapsibleBlock>

              <div style={s.diffUnchangedLine}>
                {unchangedCount} unchanged question
                {unchangedCount === 1 ? '' : 's'}.
              </div>

              {diff.has_non_sequential_numbers && (
                <div style={s.publishInfoBanner}>
                  Note: question numbers will be renumbered sequentially on publish.
                </div>
              )}
            </>
          )}
        </div>

        <div style={s.publishForm}>
          <div style={s.fieldBlock}>
            <label style={s.fieldLabel}>
              Changelog <span style={s.fieldRequired}>*</span>
            </label>
            <textarea
              className="input"
              style={s.textarea}
              placeholder="Describe what changed in this version (min 20 characters)"
              value={changelog}
              onChange={(e) => onChangeChangelog(e.target.value)}
              disabled={submitting}
            />
            <div
              style={{
                ...s.charCounter,
                color: changelogValid
                  ? 'var(--text-muted)'
                  : 'var(--risk-high)',
              }}
            >
              {charCount}/20 characters minimum
            </div>
          </div>

          <div style={s.fieldBlock}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={overrideEnabled}
                onChange={(e) => onToggleOverride(e.target.checked)}
                disabled={submitting}
              />
              <span style={s.overrideLabel}>Override version label</span>
            </label>
            {overrideEnabled && (
              <input
                className="input"
                style={{ marginTop: 6 }}
                placeholder="e.g. v2.0"
                value={overrideLabel}
                onChange={(e) => onChangeOverrideLabel(e.target.value)}
                disabled={submitting}
              />
            )}
          </div>

          <div style={s.fieldBlock}>
            <label style={s.fieldLabel}>
              Admin password <span style={s.fieldRequired}>*</span>
            </label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => onChangePassword(e.target.value)}
              disabled={submitting}
              autoComplete="current-password"
            />
          </div>

          {error && <div style={s.saveErrorText}>{error}</div>}
        </div>

        <div style={s.modalActions}>
          <button
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            {submitting ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CollapsibleBlock({ title, open, onToggle, empty, children }) {
  return (
    <div style={s.diffBlock}>
      <button
        style={s.diffBlockHeader}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span style={s.diffBlockChevron}>{open ? '▾' : '▸'}</span>
        <span>{title}</span>
      </button>
      {open && (
        <div style={s.diffBlockBody}>
          {empty ? <div style={s.diffBlockEmpty}>None.</div> : children}
        </div>
      )}
    </div>
  )
}

function EditedQuestionRow({ entry }) {
  const before = entry.before || {}
  const after = entry.after || {}
  const changedFields = []
  if (before.text !== after.text) changedFields.push('text')
  if (before.response_type !== after.response_type) changedFields.push('type')
  if (before.is_required !== after.is_required) changedFields.push('required')
  if (before.allows_other !== after.allows_other) changedFields.push('allows other')
  if ((before.hint_text || '') !== (after.hint_text || '')) changedFields.push('hint')
  const beforeOpts = (before.options || []).join('¦')
  const afterOpts = (after.options || []).join('¦')
  if (beforeOpts !== afterOpts) changedFields.push('options')

  return (
    <div style={s.diffQuestionCard}>
      <div style={s.diffQuestionMeta}>
        <span className="badge" style={s.diffBadgeEdited}>Edited</span>
        <span style={s.diffSectionPath}>{entry.section_title}</span>
        {changedFields.length > 0 && (
          <span style={s.diffChangedFields}>
            changed: {changedFields.join(', ')}
          </span>
        )}
      </div>
      <div style={s.diffBeforeAfter}>
        <div style={s.diffBeforeCol}>
          <div style={s.diffColLabel}>Before</div>
          <QuestionSnapshotView snap={before} />
        </div>
        <div style={s.diffAfterCol}>
          <div style={s.diffColLabel}>After</div>
          <QuestionSnapshotView snap={after} />
        </div>
      </div>
    </div>
  )
}

function QuestionSnapshotView({ snap }) {
  return (
    <div style={s.snapshotBox}>
      <div style={s.snapshotText}>{snap.text}</div>
      <div style={s.snapshotMeta}>
        <span className="badge" style={s.typeBadge}>
          {RESPONSE_TYPE_LABELS[snap.response_type] || snap.response_type}
        </span>
        <span
          className="badge"
          style={snap.is_required ? s.requiredBadge : s.optionalBadge}
        >
          {snap.is_required ? 'Required' : 'Optional'}
        </span>
        {snap.allows_other && (
          <span className="badge" style={s.otherBadge}>Allows "Other"</span>
        )}
      </div>
      {snap.hint_text && (
        <div style={s.snapshotHint}>Hint: {snap.hint_text}</div>
      )}
      {(snap.options || []).length > 0 && (
        <ul style={s.snapshotOptions}>
          {snap.options.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Discard modal ─────────────────────────────────────────────────────────

function DiscardModal({
  currentVersionLabel,
  text,
  onChangeText,
  submitting,
  error,
  onCancel,
  onConfirm,
}) {
  const cancelRef = useRef(null)
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  const match = text === 'DISCARD'

  return (
    <div style={s.modalOverlay} onClick={onCancel}>
      <div
        className="card"
        style={s.modalCard}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={s.modalTitle}>Discard all draft changes?</h3>
        <div style={s.modalBody}>
          This will permanently delete every change made to the draft and
          restart from the current published version ({currentVersionLabel}).
          This cannot be undone.
        </div>
        <input
          className="input"
          placeholder="Type DISCARD to confirm"
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          disabled={submitting}
        />
        {error && <div style={s.saveErrorText}>{error}</div>}
        <div style={s.modalActions}>
          <button
            ref={cancelRef}
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="btn"
            style={{
              ...s.destructiveBtn,
              ...(match && !submitting ? {} : s.destructiveBtnDisabled),
            }}
            onClick={onConfirm}
            disabled={!match || submitting}
          >
            {submitting ? 'Discarding…' : 'Discard draft'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Version history panel ─────────────────────────────────────────────────

function VersionHistoryPanel({ versions, open, onToggle }) {
  const published = useMemo(
    () =>
      (versions || [])
        .filter((v) => !v.is_draft)
        .slice()
        .sort((a, b) => {
          const ad = a.published_at ? new Date(a.published_at).getTime() : 0
          const bd = b.published_at ? new Date(b.published_at).getTime() : 0
          return bd - ad
        }),
    [versions]
  )

  return (
    <div style={s.metaSection}>
      <button
        style={s.versionsToggle}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span style={s.metaLabel}>VERSION HISTORY</span>
        <span style={s.diffBlockChevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={s.versionList}>
          {published.length === 0 ? (
            <div style={s.emptyHint}>No published versions yet.</div>
          ) : (
            published.map((v) => <VersionRow key={v.id} version={v} />)
          )}
        </div>
      )}
    </div>
  )
}

function VersionRow({ version }) {
  const [expanded, setExpanded] = useState(false)
  const changelog = version.changelog || ''
  const PREVIEW_LEN = 60
  const truncated = changelog.length > PREVIEW_LEN
  const previewText = truncated ? `${changelog.slice(0, PREVIEW_LEN)}…` : changelog

  return (
    <div
      style={{ ...s.versionRow, cursor: 'pointer' }}
      onClick={() => setExpanded((v) => !v)}
      role="button"
      aria-expanded={expanded}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setExpanded((v) => !v)
        }
      }}
    >
      <div style={s.versionRowHeader}>
        <span style={s.versionLabelMono}>{version.version_label}</span>
        {version.is_current && (
          <span className="badge" style={s.currentBadge}>current</span>
        )}
        <span style={s.versionDate}>
          {version.published_at ? formatTimestamp(version.published_at) : '—'}
        </span>
        <span
          style={{
            ...s.versionChevron,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
          aria-hidden="true"
        >
          ▸
        </span>
      </div>
      {changelog && !expanded && (
        <div style={s.versionChangelog}>{previewText}</div>
      )}
      {changelog && expanded && (
        <div style={{ ...s.versionChangelog, whiteSpace: 'pre-wrap' }}>
          {changelog}
        </div>
      )}
    </div>
  )
}

function Toast({ message, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500)
    return () => clearTimeout(t)
  }, [onDismiss])
  return (
    <div style={s.toast}>
      <span>{message}</span>
      <button style={s.toastClose} onClick={onDismiss}>×</button>
    </div>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────────

const s = {
  headerRow: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 16, marginBottom: 20,
  },
  pageTitle: {
    fontSize: 'var(--text-xl)', fontWeight: 600,
    color: 'var(--text-primary)', letterSpacing: '-0.01em',
  },
  pageSub: {
    marginTop: 4, fontSize: 'var(--text-sm)',
    color: 'var(--text-secondary)', maxWidth: 640, lineHeight: 1.5,
  },
  loading: {
    padding: '40px 0', textAlign: 'center',
    fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
  },
  errorBanner: {
    padding: '10px 14px',
    background: 'var(--risk-high-bg)',
    border: '1px solid var(--risk-high)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    color: 'var(--risk-high)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '240px minmax(0, 1fr) 360px',
    gap: 16,
    alignItems: 'start',
  },
  leftCol: {
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    position: 'sticky', top: 16,
    maxHeight: 'calc(100vh - 48px)',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border)',
    padding: '0 4px',
  },
  tabBtn: {
    flex: 1, padding: '10px 8px',
    fontSize: 'var(--text-xs)', letterSpacing: '0.02em',
  },
  sectionList: {
    display: 'flex', flexDirection: 'column',
    padding: 4, gap: 2,
    overflowY: 'auto', flex: 1,
  },
  addSectionRow: {
    padding: '8px 8px 10px',
    borderTop: '1px solid var(--border)',
  },
  emptyHint: {
    padding: '16px 10px',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
  },
  sectionItem: {
    display: 'flex', alignItems: 'center',
    gap: 4, padding: '4px 4px 4px 4px',
    background: 'transparent',
    borderLeft: '2px solid transparent',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    transition: 'background-color 150ms ease, color 150ms ease',
  },
  sectionItemActive: {
    background: 'var(--accent-subtle)',
    borderLeftColor: 'var(--accent)',
    color: 'var(--accent)',
  },
  sectionItemBody: {
    flex: 1, minWidth: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    gap: 2, padding: '4px 6px',
    background: 'transparent', border: 'none',
    textAlign: 'left', cursor: 'pointer',
    color: 'inherit', fontFamily: 'inherit',
  },
  sectionItemTitle: {
    fontSize: 'var(--text-sm)', fontWeight: 500, lineHeight: 1.35,
    wordBreak: 'break-word',
  },
  sectionItemCount: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
  },
  sectionRenameInput: {
    height: 28, padding: '2px 6px',
    fontSize: 'var(--text-sm)',
    width: '100%',
  },
  dragHandleBtn: {
    background: 'transparent', border: 'none',
    padding: 4, cursor: 'grab',
    color: 'var(--text-muted)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  iconBtn: {
    background: 'transparent', border: 'none',
    padding: 4, cursor: 'pointer',
    color: 'var(--text-muted)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  menu: {
    position: 'fixed',
    minWidth: 180,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-md)',
    zIndex: 1000,
    padding: 4,
    display: 'flex', flexDirection: 'column',
  },
  middleCol: {
    display: 'flex', flexDirection: 'column', gap: 12,
    minWidth: 0,
  },
  sectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, padding: '2px 4px',
  },
  sectionTitleGroup: {
    display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
  },
  sectionTitle: {
    fontSize: 'var(--text-lg)', fontWeight: 600,
    color: 'var(--text-primary)', letterSpacing: '-0.01em',
    wordBreak: 'break-word',
  },
  sectionCount: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  questionList: {
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  questionCard: {
    padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: 8,
    cursor: 'pointer',
  },
  editCard: {
    padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: 12,
    borderColor: 'var(--accent)',
    boxShadow: 'var(--shadow-sm)',
  },
  editHeader: {
    display: 'flex', alignItems: 'center', gap: 8,
    flexWrap: 'wrap',
  },
  questionHeader: {
    display: 'flex', gap: 8, alignItems: 'flex-start',
  },
  questionNumber: {
    fontFamily: 'Geist Mono, monospace',
    fontSize: 'var(--text-xs)',
    fontWeight: 600, color: 'var(--text-muted)',
    letterSpacing: '0.02em', flexShrink: 0,
    paddingTop: 2, minWidth: 28,
  },
  questionText: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)', lineHeight: 1.5,
    flex: 1, wordBreak: 'break-word',
  },
  questionMeta: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
    paddingLeft: 40,
  },
  typeBadge: { background: 'var(--bg-muted)', color: 'var(--text-secondary)' },
  requiredBadge: {
    background: 'color-mix(in srgb, var(--risk-medium) 18%, transparent)',
    color: 'var(--risk-medium)',
  },
  optionalBadge: { background: 'var(--bg-subtle)', color: 'var(--text-muted)' },
  otherBadge: { background: 'var(--blue-subtle)', color: 'var(--blue)' },
  newBadge: {
    background: 'color-mix(in srgb, var(--status-risk-pending) 18%, transparent)',
    color: 'var(--status-risk-pending)',
  },
  optionCount: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)' },
  questionKeyLabel: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  questionKey: {
    fontFamily: 'Geist Mono, monospace',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
  },
  fieldBlock: {
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  fieldRow: {
    display: 'flex', gap: 12, alignItems: 'flex-start',
  },
  fieldLabel: {
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  textarea: {
    minHeight: 80, resize: 'vertical',
    fontFamily: 'inherit', fontSize: 'var(--text-sm)',
    padding: 8,
  },
  hintArea: {
    minHeight: 60, resize: 'vertical',
    fontFamily: 'inherit', fontSize: 'var(--text-sm)',
    padding: 8,
  },
  linkBtn: {
    background: 'transparent', border: 'none',
    color: 'var(--accent)',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer', padding: 0,
    alignSelf: 'flex-start',
  },
  optionList: {
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  optionRow: {
    display: 'flex', alignItems: 'center', gap: 6,
  },
  emptyOptions: {
    fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
    padding: '6px 0',
  },
  deleteBtn: {
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    color: 'var(--risk-high)',
    padding: '0 8px',
    height: 34,
  },
  emptyPanel: {
    padding: 20, fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)', textAlign: 'center',
  },
  rightCol: {
    padding: 0, position: 'sticky', top: 16,
    display: 'flex', flexDirection: 'column',
  },
  metaSection: {
    padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  metaDivider: { height: 1, background: 'var(--border)' },
  metaLabel: {
    fontSize: 'var(--text-xs)', fontWeight: 500,
    color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  metaVersionRow: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  },
  metaVersionLabel: {
    fontFamily: 'Geist Mono, monospace',
    fontSize: 'var(--text-md)', fontWeight: 600,
    color: 'var(--text-primary)',
  },
  draftBadge: {
    background: 'color-mix(in srgb, var(--status-draft) 20%, transparent)',
    color: 'var(--status-draft)',
  },
  dirtyChip: {
    background: 'color-mix(in srgb, var(--status-risk-pending) 18%, transparent)',
    color: 'var(--status-risk-pending)',
  },
  metaHint: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    lineHeight: 1.5,
  },
  metaValue: { fontSize: 'var(--text-sm)', color: 'var(--text-primary)' },
  metaAction: { width: '100%' },
  metaActions: { display: 'flex', flexDirection: 'column', gap: 8 },
  saveErrorText: {
    marginTop: 4,
    fontSize: 'var(--text-xs)',
    color: 'var(--risk-high)',
    lineHeight: 1.4,
  },

  modalOverlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 50,
  },
  modalCard: {
    maxWidth: 480, padding: 20,
    display: 'flex', flexDirection: 'column', gap: 14,
  },
  modalTitle: {
    fontSize: 'var(--text-lg)', fontWeight: 600,
    color: 'var(--text-primary)',
  },
  modalBody: {
    fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  modalActions: {
    display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap',
  },
  toast: {
    position: 'fixed', bottom: 24, right: 24,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-md)',
    padding: '10px 14px',
    display: 'flex', alignItems: 'center', gap: 12,
    fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
    zIndex: 60,
    maxWidth: 480,
  },
  toastClose: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: 'var(--text-md)', color: 'var(--text-muted)',
    padding: 0, lineHeight: 1,
  },

  // Publish modal — single scroll context: the modal card itself. Inner
  // sections (header, body, form) stack normally and grow to fit their
  // content; nothing inside has its own overflow.
  publishModalCard: {
    width: 'min(860px, 94vw)',
    maxHeight: '90vh',
    display: 'flex', flexDirection: 'column',
    padding: 0,
    overflow: 'auto',
  },
  publishHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--border)',
  },
  publishVersionStrip: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontFamily: 'Geist Mono, monospace',
    fontSize: 'var(--text-sm)',
  },
  publishVersionFrom: { color: 'var(--text-muted)' },
  publishVersionArrow: { color: 'var(--text-muted)' },
  publishVersionTo: { color: 'var(--accent)', fontWeight: 600 },
  publishBody: {
    padding: '12px 20px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  publishForm: {
    padding: '12px 20px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-subtle)',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  publishInfoBanner: {
    padding: '8px 12px',
    background: 'var(--blue-subtle)',
    border: '1px solid color-mix(in srgb, var(--blue) 30%, transparent)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-xs)',
    color: 'var(--blue)',
  },
  charCounter: {
    fontSize: 'var(--text-xs)', marginTop: 4,
  },
  overrideLabel: {
    fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
  },
  fieldRequired: { color: 'var(--risk-high)' },

  diffBlock: {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface)',
    overflow: 'hidden',
  },
  diffBlockHeader: {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%',
    padding: '8px 12px',
    background: 'var(--bg-subtle)',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    color: 'var(--text-primary)',
    textAlign: 'left',
  },
  diffBlockChevron: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    width: 12, display: 'inline-block',
  },
  diffBlockBody: {
    padding: 12,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  diffBlockEmpty: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  diffSectionBlock: {
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  diffSectionRow: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    fontSize: 'var(--text-sm)',
  },
  diffSectionTitle: {
    fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
  },
  diffBefore: { color: 'var(--text-muted)', textDecoration: 'line-through' },
  diffAfter: { color: 'var(--text-primary)', fontWeight: 500 },
  diffArrow: { color: 'var(--text-muted)', margin: '0 4px' },
  diffBadgeAdded: {
    background: 'color-mix(in srgb, var(--risk-low) 20%, transparent)',
    color: 'var(--risk-low)',
  },
  diffBadgeRemoved: {
    background: 'color-mix(in srgb, var(--risk-high) 18%, transparent)',
    color: 'var(--risk-high)',
  },
  diffBadgeEdited: {
    background: 'color-mix(in srgb, var(--status-risk-pending) 18%, transparent)',
    color: 'var(--status-risk-pending)',
  },
  diffQuestionCard: {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: 10,
    display: 'flex', flexDirection: 'column', gap: 6,
    background: 'var(--bg-surface)',
  },
  diffQuestionMeta: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  },
  diffSectionPath: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    letterSpacing: '0.02em',
  },
  diffQuestionText: {
    fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
    lineHeight: 1.5,
  },
  diffChangedFields: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  diffBeforeAfter: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
  },
  diffBeforeCol: {
    display: 'flex', flexDirection: 'column', gap: 4,
    minWidth: 0,
  },
  diffAfterCol: {
    display: 'flex', flexDirection: 'column', gap: 4,
    minWidth: 0,
  },
  diffColLabel: {
    fontSize: 'var(--text-xs)', fontWeight: 500,
    color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.04em',
  },
  snapshotBox: {
    padding: 8,
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    display: 'flex', flexDirection: 'column', gap: 6,
    minWidth: 0,
  },
  snapshotText: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  snapshotMeta: {
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
  },
  snapshotHint: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  snapshotOptions: {
    margin: 0, paddingLeft: 18,
    fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
    lineHeight: 1.6,
  },
  diffUnchangedLine: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    padding: '4px 2px',
  },

  // Discard modal
  destructiveBtn: {
    background: 'var(--risk-high)',
    color: 'white',
    border: '1px solid var(--risk-high)',
  },
  destructiveBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },

  // Version history
  versionsToggle: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%',
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'var(--text-muted)',
  },
  versionList: {
    marginTop: 8,
    display: 'flex', flexDirection: 'column', gap: 8,
    maxHeight: 320, overflowY: 'auto',
  },
  versionRow: {
    padding: '8px 10px',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  versionRowHeader: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  },
  versionLabelMono: {
    fontFamily: 'Geist Mono, monospace',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    color: 'var(--accent)',
  },
  currentBadge: {
    background: 'color-mix(in srgb, var(--status-closed) 20%, transparent)',
    color: 'var(--status-closed)',
  },
  versionDate: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    marginLeft: 'auto',
  },
  versionChangelog: {
    fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  versionChevron: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    transition: 'transform 150ms ease',
    display: 'inline-block',
    marginLeft: 6,
    width: 10,
  },
}
