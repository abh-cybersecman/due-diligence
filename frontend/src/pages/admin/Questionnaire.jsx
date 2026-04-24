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

function formatTimestamp(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('standard')
  const [activeSectionId, setActiveSectionId] = useState(null)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [typeChangePrompt, setTypeChangePrompt] = useState(null)
  const [keyChangeNotice, setKeyChangeNotice] = useState(null)
  const [renumberPrompt, setRenumberPrompt] = useState(false)
  const [renumberNotice, setRenumberNotice] = useState(null)
  const [dirtyPrompt, setDirtyPrompt] = useState(null)
  const activeFormRef = useRef(null)

  const registerActiveForm = useCallback((reg) => {
    activeFormRef.current = reg
  }, [])

  const guardSwitch = useCallback((proceed) => {
    const form = activeFormRef.current
    if (!form || !form.isDirty()) { proceed(); return }
    setDirtyPrompt({
      onSave: async () => {
        try { await form.save() }
        catch { setDirtyPrompt(null); return }
        setDirtyPrompt(null)
        proceed()
      },
      onDiscard: () => {
        form.discard()
        setDirtyPrompt(null)
        proceed()
      },
      onCancel: () => setDirtyPrompt(null),
    })
  }, [])

  // Browser-level unsaved-changes warning.
  useEffect(() => {
    function handler(e) {
      if (activeFormRef.current?.isDirty?.()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const loadDraft = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/questionnaire/draft')
      if (!res.ok) throw new Error('Failed to load draft questionnaire')
      const data = await res.json()
      setDraft(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [adminFetch])

  useEffect(() => {
    loadDraft()
  }, [loadDraft])

  // Apply a section update locally (no fetch).
  const applySectionLocal = useCallback((sectionId, patch) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        sections: prev.sections.map((s) =>
          s.id === sectionId ? { ...s, ...patch } : s
        ),
      }
    })
  }, [])

  const applyQuestionLocal = useCallback((questionId, patchFn) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        sections: prev.sections.map((s) => ({
          ...s,
          questions: (s.questions || []).map((q) =>
            q.id === questionId ? patchFn(q) : q
          ),
        })),
      }
    })
  }, [])

  const replaceQuestion = useCallback((serverQuestion) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        sections: prev.sections.map((s) => {
          // Remove the question from any section it isn't in, then add/replace
          // in its new section. This handles inter-section moves.
          const withoutIt = (s.questions || []).filter((q) => q.id !== serverQuestion.id)
          if (s.id === serverQuestion.section_id) {
            return {
              ...s,
              questions: [...withoutIt, serverQuestion].sort((a, b) => a.order - b.order),
            }
          }
          return { ...s, questions: withoutIt }
        }),
      }
    })
  }, [])

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

  // ── API helpers with save status ───────────────────────────────────────

  const withSaveStatus = useCallback(async (fn) => {
    setSaveStatus('saving')
    try {
      const result = await fn()
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 1500)
      return result
    } catch (err) {
      setSaveStatus('error')
      throw err
    }
  }, [])

  // ── Section mutations ─────────────────────────────────────────────────

  async function addSection(isAI) {
    await withSaveStatus(async () => {
      const res = await adminFetch('/api/admin/questionnaire/draft/sections', {
        method: 'POST',
        body: JSON.stringify({
          title: 'New section',
          is_ai_addendum: isAI,
        }),
      })
      if (!res.ok) throw new Error('Failed to create section')
      const section = await res.json()
      setDraft((prev) => ({ ...prev, sections: [...prev.sections, section] }))
      setTab(isAI ? 'ai' : 'standard')
      setActiveSectionId(section.id)
    })
  }

  async function saveSection(sectionId, patch) {
    await withSaveStatus(async () => {
      const res = await adminFetch(
        `/api/admin/questionnaire/draft/sections/${sectionId}`,
        { method: 'PATCH', body: JSON.stringify(patch) }
      )
      if (!res.ok) throw new Error('Failed to save section')
      const updated = await res.json()
      applySectionLocal(sectionId, updated)
    })
  }

  async function deleteSection(sectionId) {
    await withSaveStatus(async () => {
      const res = await adminFetch(
        `/api/admin/questionnaire/draft/sections/${sectionId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('Failed to delete section')
      setDraft((prev) => ({
        ...prev,
        sections: prev.sections.filter((s) => s.id !== sectionId),
      }))
    })
  }

  async function reorderSections(newOrderedSections) {
    // newOrderedSections is the new order within the current tab's filter.
    // We apply the new `order` values within that subset.
    const section_orders = newOrderedSections.map((s, idx) => ({
      id: s.id,
      order: idx,
    }))
    // Optimistic local update
    setDraft((prev) => {
      const idMap = new Map(section_orders.map((o) => [o.id, o.order]))
      return {
        ...prev,
        sections: prev.sections.map((s) =>
          idMap.has(s.id) ? { ...s, order: idMap.get(s.id) } : s
        ),
      }
    })
    await withSaveStatus(async () => {
      const res = await adminFetch('/api/admin/questionnaire/draft/reorder', {
        method: 'POST',
        body: JSON.stringify({ section_orders }),
      })
      if (!res.ok) throw new Error('Failed to reorder sections')
    })
  }

  // ── Question mutations ────────────────────────────────────────────────

  async function addQuestion(sectionId) {
    await withSaveStatus(async () => {
      const res = await adminFetch('/api/admin/questionnaire/draft/questions', {
        method: 'POST',
        body: JSON.stringify({
          section_id: sectionId,
          question_text: 'New question',
          response_type: 'TEXT',
          is_required: true,
        }),
      })
      if (!res.ok) throw new Error('Failed to create question')
      const payload = await res.json()
      const q = payload.question
      setDraft((prev) => ({
        ...prev,
        sections: prev.sections.map((s) =>
          s.id === sectionId
            ? { ...s, questions: [...(s.questions || []), q] }
            : s
        ),
      }))
    })
  }

  async function saveQuestion(questionId, patch, { onWarnings } = {}) {
    return withSaveStatus(async () => {
      const res = await adminFetch(
        `/api/admin/questionnaire/draft/questions/${questionId}`,
        { method: 'PATCH', body: JSON.stringify(patch) }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || 'Failed to save question')
      }
      const payload = await res.json()
      replaceQuestion(payload.question)
      if (payload.warnings && payload.warnings.length && onWarnings) {
        onWarnings(payload.warnings, payload.question)
      }
      return payload
    })
  }

  async function deleteQuestion(questionId) {
    await withSaveStatus(async () => {
      const res = await adminFetch(
        `/api/admin/questionnaire/draft/questions/${questionId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('Failed to delete question')
      setDraft((prev) => ({
        ...prev,
        sections: prev.sections.map((s) => ({
          ...s,
          questions: (s.questions || []).filter((q) => q.id !== questionId),
        })),
      }))
    })
  }

  async function reorderQuestions(sectionId, orderedQuestions) {
    const question_orders = {
      [sectionId]: orderedQuestions.map((q, idx) => ({ id: q.id, order: idx })),
    }
    // Optimistic local reorder
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== sectionId) return s
        const orderMap = new Map(question_orders[sectionId].map((o) => [o.id, o.order]))
        return {
          ...s,
          questions: (s.questions || [])
            .map((q) => (orderMap.has(q.id) ? { ...q, order: orderMap.get(q.id) } : q))
            .sort((a, b) => a.order - b.order),
        }
      }),
    }))
    await withSaveStatus(async () => {
      const res = await adminFetch('/api/admin/questionnaire/draft/reorder', {
        method: 'POST',
        body: JSON.stringify({ question_orders }),
      })
      if (!res.ok) throw new Error('Failed to reorder questions')
    })
  }

  // ── Response-type confirm modal wiring ─────────────────────────────────

  function requestResponseTypeChange(question, newType, commit) {
    setTypeChangePrompt({
      question,
      newType,
      commit, // function to run if confirmed
    })
  }

  function openPreview() {
    window.open(`${BASE_PATH}/admin/questionnaire/preview`, '_blank', 'noopener,noreferrer')
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

  const lastEdited = draft ? (draft.updated_at || draft.created_at) : null

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
        <SaveIndicator status={saveStatus} />
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
                onClick={() => guardSwitch(() => setTab('standard'))}
              >
                Standard
              </button>
              <button
                className={`tab-btn${tab === 'ai' ? ' tab-btn--active' : ''}`}
                style={s.tabBtn}
                onClick={() => guardSwitch(() => setTab('ai'))}
              >
                AI Addendum
              </button>
            </div>

            <SectionList
              sections={sectionsForTab}
              activeSectionId={activeSectionId}
              onSelect={(id) => guardSwitch(() => setActiveSectionId(id))}
              onReorder={reorderSections}
              onRename={(id, title) => saveSection(id, { title })}
              onToggleAI={(sec) =>
                saveSection(sec.id, { is_ai_addendum: !sec.is_ai_addendum })
              }
              onDelete={deleteSection}
            />

            <div style={s.addSectionRow}>
              <button
                className="btn btn-secondary"
                style={{ width: '100%' }}
                onClick={() => guardSwitch(() => addSection(tab === 'ai'))}
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
                onReorderQuestions={(ordered) => reorderQuestions(activeSection.id, ordered)}
                onAddQuestion={() => addQuestion(activeSection.id)}
                onSaveQuestion={saveQuestion}
                onDeleteQuestion={deleteQuestion}
                onRequestTypeChange={requestResponseTypeChange}
                onKeyRegenerated={(q) => setKeyChangeNotice(q)}
                guardSwitch={guardSwitch}
                registerActiveForm={registerActiveForm}
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
                onClick={openPreview}
              >
                Preview as vendor
              </button>
            </div>

            <div style={s.metaDivider} />

            <div style={s.metaSection}>
              <button
                className="btn btn-secondary"
                style={s.metaAction}
                onClick={() => setRenumberPrompt(true)}
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
                  disabled
                  title="Discard arrives in a later phase"
                >
                  Discard draft
                </button>
                <button
                  className="btn btn-primary"
                  style={s.metaAction}
                  disabled
                  title="Publish arrives in a later phase"
                >
                  Publish
                </button>
              </div>
            </div>
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
              treat this as a new question for refresh matching — a new key will be minted.
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

      {keyChangeNotice && (
        <Toast
          message={`New key minted: ${keyChangeNotice.question_key}`}
          onDismiss={() => setKeyChangeNotice(null)}
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

      {dirtyPrompt && (
        <DirtySwitchPrompt
          onSave={dirtyPrompt.onSave}
          onDiscard={dirtyPrompt.onDiscard}
          onCancel={dirtyPrompt.onCancel}
        />
      )}
    </AdminLayout>
  )
}

// ─── Save indicator ────────────────────────────────────────────────────────

function SaveIndicator({ status }) {
  if (status === 'idle') return <span style={s.saveDot} />
  if (status === 'saving') return <span style={s.saveText}>Saving…</span>
  if (status === 'saved') return <span style={{ ...s.saveText, color: 'var(--risk-low)' }}>✓ Saved</span>
  if (status === 'error') return <span style={{ ...s.saveText, color: 'var(--risk-high)' }}>Save failed</span>
  return null
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
                onToggleAI={() => onToggleAI(section)}
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
  onSaveQuestion,
  onDeleteQuestion,
  onRequestTypeChange,
  onKeyRegenerated,
  guardSwitch,
  registerActiveForm,
}) {
  const [expandedId, setExpandedId] = useState(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const requestToggle = (qid) => {
    guardSwitch(() => setExpandedId((id) => (id === qid ? null : qid)))
  }
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
                  onToggle={() => requestToggle(q.id)}
                  onSave={onSaveQuestion}
                  onDelete={() => {
                    if (window.confirm(`Delete question Q${q.question_number}?`)) onDeleteQuestion(q.id)
                  }}
                  onRequestTypeChange={onRequestTypeChange}
                  onKeyRegenerated={onKeyRegenerated}
                  registerActiveForm={registerActiveForm}
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
  onSave,
  onDelete,
  onRequestTypeChange,
  onKeyRegenerated,
  registerActiveForm,
  dragAttributes,
  dragListeners,
}) {
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
          <span style={s.questionNumber}>Q{question.question_number}</span>
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
      onSave={onSave}
      onDelete={onDelete}
      onRequestTypeChange={onRequestTypeChange}
      onKeyRegenerated={onKeyRegenerated}
      registerActiveForm={registerActiveForm}
      dragAttributes={dragAttributes}
      dragListeners={dragListeners}
    />
  )
}

function QuestionEditForm({
  question,
  onCollapse,
  onSave,
  onDelete,
  onRequestTypeChange,
  onKeyRegenerated,
  registerActiveForm,
  dragAttributes,
  dragListeners,
}) {
  // Local editable copy. Edits stay local until the user clicks Save.
  const [original, setOriginal] = useState(question)
  const [local, setLocal] = useState(question)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [showHint, setShowHint] = useState(Boolean(question.hint_text))

  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  // Reconcile server-side identity changes (key regen, number shifts) without
  // clobbering in-flight local edits.
  useEffect(() => {
    setLocal((prev) => ({
      ...prev,
      question_key: question.question_key,
      question_number: question.question_number,
    }))
    setOriginal((prev) => ({
      ...prev,
      question_key: question.question_key,
      question_number: question.question_number,
    }))
  }, [question.question_key, question.question_number])

  // Auto-clear "Saved just now" after 3s.
  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(null), 3000)
    return () => clearTimeout(t)
  }, [savedAt])

  function markDirty(next) {
    setLocal(next)
    setDirty(true)
    setSavedAt(null)
  }

  function updateField(field, value) {
    markDirty({ ...local, [field]: value })
  }

  // Response type change — confirmation modal first, then update local only.
  function handleResponseTypeChange(newType) {
    onRequestTypeChange(local, newType, (confirmedType) => {
      if (confirmedType === null) return
      const isChoice = CHOICE_TYPES.has(newType)
      markDirty({
        ...local,
        response_type: newType,
        allows_other: isChoice ? local.allows_other : false,
        options: isChoice ? local.options : [],
      })
    })
  }

  function handleOptionChange(idx, label) {
    markDirty({
      ...local,
      options: local.options.map((o, i) => (i === idx ? { ...o, label } : o)),
    })
  }

  function handleAddOption() {
    const len = local.options?.length ?? 0
    markDirty({
      ...local,
      options: [...(local.options || []), { id: null, label: `Option ${len + 1}`, order: len }],
    })
  }

  function handleDeleteOption(idx) {
    markDirty({ ...local, options: local.options.filter((_, i) => i !== idx) })
  }

  function handleOptionDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = local.options.findIndex((o) => optionKey(o) === active.id)
    const newIndex = local.options.findIndex((o) => optionKey(o) === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    markDirty({ ...local, options: arrayMove(local.options, oldIndex, newIndex) })
  }

  const handleSave = useCallback(async () => {
    if (!dirtyRef.current) return
    const isChoice = CHOICE_TYPES.has(local.response_type)
    const patch = {
      question_text: local.question_text,
      response_type: local.response_type,
      is_required: local.is_required,
      allows_other: isChoice ? local.allows_other : false,
      hint_text: local.hint_text && local.hint_text.length ? local.hint_text : null,
      ...(isChoice
        ? { options: (local.options || []).map((o) => ({ id: o.id, label: o.label })) }
        : {}),
    }
    const payload = await onSave(question.id, patch, {
      onWarnings: (_w, serverQ) => onKeyRegenerated?.(serverQ),
    })
    const saved = payload?.question || local
    setLocal(saved)
    setOriginal(saved)
    setDirty(false)
    setSavedAt(Date.now())
  }, [local, onSave, question.id, onKeyRegenerated])

  const handleCancel = useCallback(() => {
    setLocal(original)
    setDirty(false)
    setSavedAt(null)
    setShowHint(Boolean(original.hint_text))
  }, [original])

  // Stable wrappers so the registration effect only runs once on mount.
  const saveRef = useRef(handleSave)
  const cancelRef = useRef(handleCancel)
  saveRef.current = handleSave
  cancelRef.current = handleCancel

  useEffect(() => {
    registerActiveForm({
      isDirty: () => dirtyRef.current,
      save: () => saveRef.current(),
      discard: () => cancelRef.current(),
    })
    return () => registerActiveForm(null)
  }, [registerActiveForm])

  // Cmd/Ctrl+S saves the current form (only one edit form is mounted at a time).
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        saveRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const isChoice = CHOICE_TYPES.has(local.response_type)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

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
        <span style={s.questionNumber}>Q{local.question_number}</span>
        <span style={s.questionKeyLabel}>Key:</span>
        <span style={s.questionKey}>{local.question_key}</span>
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
          value={local.question_text}
          onChange={(e) => updateField('question_text', e.target.value)}
        />
      </div>

      <div style={s.fieldRow}>
        <div style={{ flex: 1 }}>
          <label style={s.fieldLabel}>Response type</label>
          <select
            className="input"
            value={local.response_type}
            onChange={(e) => {
              if (e.target.value !== local.response_type) {
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
            checked={local.is_required}
            onChange={(e) => updateField('is_required', e.target.checked)}
          />
          Required
        </label>
      </div>

      <div style={s.fieldBlock}>
        {showHint || local.hint_text ? (
          <>
            <label style={s.fieldLabel}>Hint text</label>
            <textarea
              className="input"
              style={s.hintArea}
              placeholder="Optional — shown below the question"
              value={local.hint_text || ''}
              onChange={(e) => updateField('hint_text', e.target.value)}
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
          {(local.options || []).length === 0 ? (
            <div style={s.emptyOptions}>No options yet.</div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleOptionDragEnd}>
              <SortableContext
                items={(local.options || []).map(optionKey)}
                strategy={verticalListSortingStrategy}
              >
                <div style={s.optionList}>
                  {local.options.map((opt, idx) => (
                    <SortableOptionRow
                      key={optionKey(opt)}
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
              checked={local.allows_other}
              onChange={(e) => updateField('allows_other', e.target.checked)}
            />
            Allow "Other" response
          </label>
        </div>
      )}

      <div style={s.editFooter}>
        <span
          style={{
            ...s.footerIndicator,
            color: dirty
              ? 'var(--status-risk-pending)'
              : savedAt
                ? 'var(--risk-low)'
                : 'var(--text-muted)',
          }}
        >
          {dirty ? 'Unsaved changes' : savedAt ? '✓ Saved just now' : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={handleCancel}
            disabled={!dirty}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!dirty}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function optionKey(opt) {
  // Stable key for drag items: use id for existing, label+index for new.
  return opt.id || `new:${opt.label}:${opt.order ?? 0}`
}

function SortableOptionRow({ option, onChange, onDelete }) {
  const id = optionKey(option)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
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

// ─── Confirm modal ─────────────────────────────────────────────────────────

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

function DirtySwitchPrompt({ onSave, onDiscard, onCancel }) {
  return (
    <div style={s.modalOverlay} onClick={onCancel}>
      <div className="card" style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={s.modalTitle}>Unsaved changes</h3>
        <div style={s.modalBody}>
          You have unsaved changes in this question. Save them, discard, or cancel?
        </div>
        <div style={s.modalActions}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-secondary" onClick={onDiscard}>Discard</button>
          <button className="btn btn-primary" onClick={onSave}>Save</button>
        </div>
      </div>
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
  saveText: {
    fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
  },
  saveDot: { width: 0, height: 0 },
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
  editFooter: {
    display: 'flex', alignItems: 'center', gap: 12,
    marginTop: 4, paddingTop: 12,
    borderTop: '1px solid var(--border)',
  },
  footerIndicator: {
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
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
  metaVersionRow: { display: 'flex', alignItems: 'center', gap: 8 },
  metaVersionLabel: {
    fontFamily: 'Geist Mono, monospace',
    fontSize: 'var(--text-md)', fontWeight: 600,
    color: 'var(--text-primary)',
  },
  draftBadge: {
    background: 'color-mix(in srgb, var(--status-draft) 20%, transparent)',
    color: 'var(--status-draft)',
  },
  metaHint: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    lineHeight: 1.5,
  },
  metaValue: { fontSize: 'var(--text-sm)', color: 'var(--text-primary)' },
  metaAction: { width: '100%' },
  metaActions: { display: 'flex', flexDirection: 'column', gap: 8 },

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
    display: 'flex', justifyContent: 'flex-end', gap: 8,
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
  },
  toastClose: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: 'var(--text-md)', color: 'var(--text-muted)',
    padding: 0, lineHeight: 1,
  },
}
