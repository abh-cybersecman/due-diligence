import React, { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'

function useAdminFetch() {
  const { adminSession } = useAuth()
  return (path, opts = {}) =>
    fetch(`${BASE_PATH}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSession?.accessToken}`,
        ...(opts.headers || {}),
      },
    })
}

const RESPONSE_TYPE_LABELS = {
  TEXT: 'Text',
  SINGLE_CHOICE: 'Single choice',
  MULTI_CHOICE: 'Multi choice',
  FILE_UPLOAD: 'File upload',
}

function formatTimestamp(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function FileTextIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  )
}

export { FileTextIcon }

export default function Questionnaire() {
  const adminFetch = useAdminFetch()
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('standard') // 'standard' | 'ai'
  const [activeSectionId, setActiveSectionId] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await adminFetch('/api/admin/questionnaire/draft')
        if (!res.ok) throw new Error('Failed to load draft questionnaire')
        const data = await res.json()
        if (cancelled) return
        setDraft(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sectionsForTab = useMemo(() => {
    if (!draft) return []
    const isAI = tab === 'ai'
    return draft.sections
      .filter((s) => !!s.is_ai_addendum === isAI)
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

  function openPreview() {
    window.open(`${BASE_PATH}/admin/questionnaire/preview`, '_blank', 'noopener,noreferrer')
  }

  const lastEdited = draft ? (draft.updated_at || draft.created_at) : null

  return (
    <AdminLayout>
      <div style={s.headerRow}>
        <div>
          <h1 style={s.pageTitle}>Questionnaire</h1>
          <p style={s.pageSub}>
            Draft version of the vendor security questionnaire. Editing, publishing and
            version history arrive in later phases.
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
          {/* ── Left column: sections list ────────────────────────────── */}
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

            <div style={s.sectionList}>
              {sectionsForTab.length === 0 ? (
                <div style={s.emptyHint}>
                  {tab === 'ai' ? 'No AI addendum sections.' : 'No sections.'}
                </div>
              ) : (
                sectionsForTab.map((section) => {
                  const isActive = section.id === activeSectionId
                  const count = section.questions?.length ?? 0
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSectionId(section.id)}
                      style={{
                        ...s.sectionItem,
                        ...(isActive ? s.sectionItemActive : {}),
                      }}
                    >
                      <span style={s.sectionItemTitle}>{section.title}</span>
                      <span style={s.sectionItemCount}>
                        {count} {count === 1 ? 'question' : 'questions'}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </aside>

          {/* ── Middle column: questions ──────────────────────────────── */}
          <main style={s.middleCol}>
            {!activeSection ? (
              <div className="card" style={s.emptyPanel}>
                Select a section to view its questions.
              </div>
            ) : (
              <>
                <div style={s.sectionHeader}>
                  <div style={s.sectionTitleGroup}>
                    {activeSection.is_ai_addendum && (
                      <span
                        className="badge"
                        style={{ background: 'var(--blue-subtle)', color: 'var(--blue)' }}
                      >
                        AI Addendum
                      </span>
                    )}
                    <h2 style={s.sectionTitle}>{activeSection.title}</h2>
                  </div>
                  <span style={s.sectionCount}>
                    {activeSection.questions.length}{' '}
                    {activeSection.questions.length === 1 ? 'question' : 'questions'}
                  </span>
                </div>

                <div style={s.questionList}>
                  {activeSection.questions
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((q) => (
                      <QuestionCard key={q.id} question={q} />
                    ))}
                  {activeSection.questions.length === 0 && (
                    <div className="card" style={s.emptyPanel}>
                      No questions in this section.
                    </div>
                  )}
                </div>
              </>
            )}
          </main>

          {/* ── Right column: metadata panel ──────────────────────────── */}
          <aside style={s.rightCol} className="card">
            <div style={s.metaSection}>
              <div style={s.metaLabel}>DRAFT VERSION</div>
              <div style={s.metaVersionRow}>
                <span style={s.metaVersionLabel}>{draft.version_label}</span>
                <span className="badge" style={s.draftBadge}>Draft</span>
              </div>
              <div style={s.metaHint}>
                Changes will be applied when the draft is published.
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
    </AdminLayout>
  )
}

function QuestionCard({ question }) {
  const typeLabel = RESPONSE_TYPE_LABELS[question.response_type] || question.response_type
  return (
    <div className="card" style={s.questionCard}>
      <div style={s.questionHeader}>
        <span style={s.questionNumber}>Q{question.question_number}</span>
        <span style={s.questionText}>{question.question_text}</span>
      </div>
      <div style={s.questionMeta}>
        <span className="badge" style={s.typeBadge}>{typeLabel}</span>
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
        <span style={s.questionKey} title="Stable identifier across versions">
          {question.question_key}
        </span>
      </div>
    </div>
  )
}

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
    padding: '40px 0',
    textAlign: 'center',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
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
    flex: 1,
    padding: '10px 8px',
    fontSize: 'var(--text-xs)',
    letterSpacing: '0.02em',
  },
  sectionList: {
    display: 'flex', flexDirection: 'column',
    padding: 4, gap: 2,
    overflowY: 'auto',
  },
  emptyHint: {
    padding: '16px 10px',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
  },
  sectionItem: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    gap: 2, padding: '8px 10px',
    background: 'transparent', border: 'none',
    borderLeft: '2px solid transparent',
    borderRadius: 'var(--radius-sm)',
    textAlign: 'left', cursor: 'pointer',
    color: 'var(--text-secondary)',
    transition: 'background-color 150ms ease, color 150ms ease',
    fontFamily: 'inherit',
  },
  sectionItemActive: {
    background: 'var(--accent-subtle)',
    borderLeftColor: 'var(--accent)',
    color: 'var(--accent)',
  },
  sectionItemTitle: {
    fontSize: 'var(--text-sm)', fontWeight: 500, lineHeight: 1.35,
  },
  sectionItemCount: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
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
  },
  questionHeader: {
    display: 'flex', gap: 12, alignItems: 'flex-start',
  },
  questionNumber: {
    fontFamily: 'Geist Mono, monospace',
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    color: 'var(--text-muted)',
    letterSpacing: '0.02em',
    flexShrink: 0,
    paddingTop: 2,
    minWidth: 28,
  },
  questionText: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    lineHeight: 1.5,
    flex: 1,
    wordBreak: 'break-word',
  },
  questionMeta: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
    paddingLeft: 40,
  },
  typeBadge: {
    background: 'var(--bg-muted)',
    color: 'var(--text-secondary)',
  },
  requiredBadge: {
    background: 'color-mix(in srgb, var(--risk-medium) 18%, transparent)',
    color: 'var(--risk-medium)',
  },
  optionalBadge: {
    background: 'var(--bg-subtle)',
    color: 'var(--text-muted)',
  },
  otherBadge: {
    background: 'var(--blue-subtle)',
    color: 'var(--blue)',
  },
  optionCount: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
  },
  questionKey: {
    marginLeft: 'auto',
    fontFamily: 'Geist Mono, monospace',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
  },
  emptyPanel: {
    padding: 20,
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
  rightCol: {
    padding: 0,
    position: 'sticky', top: 16,
    display: 'flex', flexDirection: 'column',
  },
  metaSection: {
    padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  metaDivider: {
    height: 1, background: 'var(--border)',
  },
  metaLabel: {
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  metaVersionRow: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  metaVersionLabel: {
    fontFamily: 'Geist Mono, monospace',
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  draftBadge: {
    background: 'color-mix(in srgb, var(--status-draft) 20%, transparent)',
    color: 'var(--status-draft)',
  },
  metaHint: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
  },
  metaValue: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
  },
  metaAction: {
    width: '100%',
  },
  metaActions: {
    display: 'flex', flexDirection: 'column', gap: 8,
  },
}
