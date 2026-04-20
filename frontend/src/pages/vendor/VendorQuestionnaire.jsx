import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BASE_PATH } from '../../config'

// ─── helpers ─────────────────────────────────────────────────────────────────

function apiFetch(path, accessToken, options = {}) {
  return fetch(`${BASE_PATH}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  })
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_LABELS = {
  DRAFT: 'Draft',
  FUNCTIONAL_EVALUATION_PENDING: 'Awaiting Documents',
  DD_SENT_UNOPENED: 'Not Yet Started',
  DD_IN_PROGRESS: 'In Progress',
  RISK_ASSESSMENT_PENDING: 'Submitted',
  CLOSED: 'Closed',
  CLOSED_PENDING_IR_DOCS: 'Closed',
  UNDER_REVIEW: 'Under Review',
}

const STATUS_COLORS = {
  DD_SENT_UNOPENED: 'var(--status-dd-sent)',
  DD_IN_PROGRESS: 'var(--status-dd-progress)',
  RISK_ASSESSMENT_PENDING: 'var(--status-risk-pending)',
  CLOSED: 'var(--status-closed)',
  CLOSED_PENDING_IR_DOCS: 'var(--status-closed-pending)',
  UNDER_REVIEW: 'var(--status-under-review)',
}

const EDITABLE_STATUSES = new Set(['DD_SENT_UNOPENED', 'DD_IN_PROGRESS'])

// ─── ThemeToggle ──────────────────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  )
  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }
  return (
    <button onClick={toggle} title={dark ? 'Light mode' : 'Dark mode'} style={toggleStyle}>
      {dark ? '☀' : '☾'}
    </button>
  )
}

const toggleStyle = {
  width: 32, height: 32,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  fontSize: 15, cursor: 'pointer',
  transition: 'background 150ms ease, border-color 150ms ease',
  flexShrink: 0,
}

// ─── SaveStatus ───────────────────────────────────────────────────────────────

function SaveStatus({ status }) {
  if (status === 'saving') {
    return <span style={saveStyles.saving}>Saving…</span>
  }
  if (status === 'saved') {
    return <span style={saveStyles.saved}>✓ Saved</span>
  }
  if (status === 'error') {
    return <span style={saveStyles.error}>Save failed</span>
  }
  return null
}

const saveStyles = {
  saving: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)' },
  saved:  { fontSize: 'var(--text-xs)', color: 'var(--risk-low)', animation: 'fadeIn 150ms ease' },
  error:  { fontSize: 'var(--text-xs)', color: 'var(--risk-high)' },
}

// ─── SubmitModal ──────────────────────────────────────────────────────────────

function SubmitModal({ onConfirm, onCancel, submitting }) {
  return (
    <div style={modalStyles.overlay}>
      <div style={modalStyles.dialog} className="card fade-in">
        <div style={modalStyles.header}>Submit Questionnaire</div>
        <div style={modalStyles.body}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            You are about to submit this security questionnaire to the Albatha Information Security
            Team. Once submitted, the questionnaire will be locked for review.
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 10, lineHeight: 1.6 }}>
            Please ensure all required questions have been answered before submitting.
          </p>
        </div>
        <div style={modalStyles.footer}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
            Go back
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit questionnaire'}
          </button>
        </div>
      </div>
    </div>
  )
}

const modalStyles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 100, padding: 16,
  },
  dialog: {
    width: '100%', maxWidth: 460,
    padding: 0, overflow: 'hidden',
  },
  header: {
    padding: '20px 24px 16px',
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
  },
  body: { padding: '20px 24px' },
  footer: {
    padding: '16px 24px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    background: 'var(--bg-subtle)',
  },
}

// ─── FileUploadZone (for FILE_UPLOAD questions) ────────────────────────────

function QuestionFileZone({ question, files, onUpload, onDelete, isReadOnly, uploading }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)
  const questionFiles = files.filter((f) => f.question_id === question.id)
  const totalSize = questionFiles.reduce((s, f) => s + f.file_size_bytes, 0)

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    if (isReadOnly) return
    const f = e.dataTransfer.files?.[0]
    if (f) onUpload(question.id, f)
  }

  function handleInput(e) {
    const f = e.target.files?.[0]
    if (f) onUpload(question.id, f)
    e.target.value = ''
  }

  const isUploading = uploading === question.id

  return (
    <div style={fzStyles.wrapper}>
      {!isReadOnly && (
        <>
          <div
            style={{
              ...fzStyles.zone,
              borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
              background: dragOver ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
              cursor: isReadOnly ? 'default' : 'pointer',
              opacity: isUploading ? 0.6 : 1,
            }}
            onClick={() => !isReadOnly && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {isUploading ? (
              <span style={fzStyles.hint}>Uploading…</span>
            ) : (
              <span style={fzStyles.hint}>
                Drop file or{' '}
                <span style={{ color: 'var(--accent)', fontWeight: 500 }}>browse</span>
                {' '}— PDF, images, Word, Excel accepted
              </span>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleInput}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp"
          />
        </>
      )}

      {questionFiles.length > 0 && (
        <div style={fzStyles.list}>
          {questionFiles.map((f) => (
            <div key={f.id} style={fzStyles.row}>
              <span style={fzStyles.icon}>📎</span>
              <span style={fzStyles.name}>{f.original_filename}</span>
              <span style={fzStyles.size}>{formatBytes(f.file_size_bytes)}</span>
              {!isReadOnly && (
                <button style={fzStyles.del} onClick={() => onDelete(f.id)} title="Remove">×</button>
              )}
            </div>
          ))}
          <span style={fzStyles.totals}>
            {questionFiles.length} file{questionFiles.length !== 1 ? 's' : ''} · {formatBytes(totalSize)}
          </span>
        </div>
      )}

      {questionFiles.length === 0 && isReadOnly && (
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>No files uploaded</span>
      )}
    </div>
  )
}

const fzStyles = {
  wrapper: { display: 'flex', flexDirection: 'column', gap: 8 },
  zone: {
    border: '1.5px dashed',
    borderRadius: 'var(--radius-sm)',
    padding: '14px 16px',
    textAlign: 'center',
    transition: 'border-color 150ms ease, background 150ms ease',
  },
  hint: { fontSize: 'var(--text-sm)', color: 'var(--text-muted)' },
  list: { display: 'flex', flexDirection: 'column', gap: 4 },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 10px',
    background: 'var(--bg-subtle)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
  },
  icon: { fontSize: 13, flexShrink: 0 },
  name: {
    fontSize: 'var(--text-sm)', color: 'var(--text-primary)',
    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  size: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)', flexShrink: 0 },
  del: {
    background: 'transparent', border: 'none',
    color: 'var(--text-muted)', fontSize: 18, lineHeight: 1,
    cursor: 'pointer', padding: '0 2px', flexShrink: 0,
    display: 'flex', alignItems: 'center',
    transition: 'color 150ms ease',
  },
  totals: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 },
}

// ─── Main questionnaire ───────────────────────────────────────────────────────

export default function VendorQuestionnaire({ token, session, onLogout }) {
  const { accessToken, email } = session

  const [meta, setMeta] = useState(null)        // engagement info + questions
  const [responses, setResponses] = useState({}) // question_id → { response_text, selected_options }
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveStatus, setSaveStatus] = useState('idle') // idle | saving | saved | error
  const [fileError, setFileError] = useState('')
  const [uploadingQuestion, setUploadingQuestion] = useState(null)
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Pending saves — question_id → response data; flushed after debounce
  const pendingRef = useRef({})
  const saveTimerRef = useRef(null)

  // ── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [metaRes, respRes] = await Promise.all([
          apiFetch(`/api/vendor/engagements/${token}`, accessToken),
          apiFetch(`/api/vendor/engagements/${token}/responses`, accessToken),
        ])

        if (metaRes.status === 401 || metaRes.status === 403) {
          onLogout()
          return
        }
        if (!metaRes.ok || !respRes.ok) throw new Error('Failed to load questionnaire')

        const [metaData, respData] = await Promise.all([metaRes.json(), respRes.json()])

        if (!cancelled) {
          setMeta(metaData)
          setFiles(metaData.files || [])
          const responseMap = {}
          for (const r of respData) {
            responseMap[r.question_id] = {
              response_text: r.response_text ?? '',
              selected_options: r.selected_options ?? [],
            }
          }
          setResponses(responseMap)
        }
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [token, accessToken, onLogout])

  // ── Autosave ───────────────────────────────────────────────────────────────

  const flushSave = useCallback(async () => {
    const pending = Object.values(pendingRef.current)
    if (pending.length === 0) return
    pendingRef.current = {}

    setSaveStatus('saving')
    try {
      const res = await apiFetch(
        `/api/vendor/engagements/${token}/responses`,
        accessToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ responses: pending }),
        }
      )
      if (res.status === 401 || res.status === 403) { onLogout(); return }
      if (!res.ok) throw new Error('Save failed')

      // Reflect lifecycle advancement (DD_SENT_UNOPENED → DD_IN_PROGRESS)
      if (meta?.status === 'DD_SENT_UNOPENED') {
        setMeta((prev) => ({ ...prev, status: 'DD_IN_PROGRESS' }))
      }

      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 1500)
    } catch {
      setSaveStatus('error')
    }
  }, [token, accessToken, meta?.status, onLogout])

  function scheduleChange(questionId, value) {
    pendingRef.current[questionId] = {
      question_id: questionId,
      response_text: value,
      selected_options: responses[questionId]?.selected_options ?? [],
    }
    clearTimeout(saveTimerRef.current)
    setSaveStatus('saving')
    saveTimerRef.current = setTimeout(flushSave, 800)
  }

  function handleTextChange(questionId, value) {
    setResponses((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], response_text: value },
    }))
    scheduleChange(questionId, value)
  }

  // ── File upload ────────────────────────────────────────────────────────────

  async function handleFileUpload(questionId, file) {
    setFileError('')
    setUploadingQuestion(questionId)
    try {
      const form = new FormData()
      form.append('file', file)
      if (questionId) form.append('question_id', questionId)

      const res = await apiFetch(
        `/api/vendor/engagements/${token}/files`,
        accessToken,
        { method: 'POST', body: form }
      )

      if (res.status === 401 || res.status === 403) { onLogout(); return }
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail || 'Upload failed')
      }

      const uploaded = await res.json()
      setFiles((prev) => [...prev, uploaded])
    } catch (err) {
      setFileError(err.message)
    } finally {
      setUploadingQuestion(null)
    }
  }

  async function handleFileDelete(fileId) {
    setFileError('')
    try {
      const res = await apiFetch(
        `/api/vendor/engagements/${token}/files/${fileId}`,
        accessToken,
        { method: 'DELETE' }
      )
      if (res.status === 401 || res.status === 403) { onLogout(); return }
      if (!res.ok) throw new Error('Delete failed')
      setFiles((prev) => prev.filter((f) => f.id !== fileId))
    } catch (err) {
      setFileError(err.message)
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmitConfirm() {
    setSubmitting(true)
    setSubmitError('')
    try {
      // Flush any pending saves first
      clearTimeout(saveTimerRef.current)
      await flushSave()

      const res = await apiFetch(
        `/api/vendor/engagements/${token}/submit`,
        accessToken,
        { method: 'POST' }
      )
      if (res.status === 401 || res.status === 403) { onLogout(); return }
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail || 'Submission failed')
      }
      const data = await res.json()
      setMeta((prev) => ({ ...prev, status: data.status }))
      setShowSubmitModal(false)
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const isEditable = meta ? EDITABLE_STATUSES.has(meta.status) : false

  const sections = useMemo(() => {
    if (!meta?.questions) return []

    const regular = meta.questions.filter((q) => !q.is_ai_addendum)
    const ai = meta.questions.filter((q) => q.is_ai_addendum)

    function groupBySection(qs) {
      const map = {}
      for (const q of qs) {
        if (!map[q.section]) map[q.section] = []
        map[q.section].push(q)
      }
      return Object.entries(map).map(([name, questions]) => ({ name, questions }))
    }

    const result = groupBySection(regular).map((s) => ({ ...s, isAI: false }))

    if (meta.is_ai_application && ai.length > 0) {
      for (const s of groupBySection(ai)) {
        result.push({ ...s, isAI: true })
      }
    }

    return result
  }, [meta])

  const totalFiles = files.length
  const totalBytes = files.reduce((s, f) => s + f.file_size_bytes, 0)

  // ── Render guards ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={s.loadPage}>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading questionnaire…</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={s.loadPage}>
        <span style={{ color: 'var(--risk-high)', fontSize: 'var(--text-sm)' }}>{loadError}</span>
      </div>
    )
  }

  const statusLabel = STATUS_LABELS[meta?.status] || meta?.status
  const statusColor = STATUS_COLORS[meta?.status] || 'var(--text-muted)'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* Header */}
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.headerLeft}>
            <span style={s.wordmark}>ISDD Portal</span>
            <span style={s.headerSep}>|</span>
            <span style={s.headerPortal}>
              {meta?.application_name || 'Vendor Questionnaire'}
            </span>
          </div>
          <div style={s.headerRight}>
            <SaveStatus status={saveStatus} />
            {meta && (
              <span
                className="badge"
                style={{ background: statusColor + '22', color: statusColor }}
              >
                {statusLabel}
              </span>
            )}
            <ThemeToggle />
            <button
              className="btn btn-secondary"
              style={{ fontSize: 'var(--text-xs)', height: 28, padding: '0 10px' }}
              onClick={onLogout}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main style={s.main}>
        <div style={s.content} className="fade-in">

          {/* Read-only notice */}
          {!isEditable && meta?.status !== 'DD_SENT_UNOPENED' && (
            <div style={s.readOnlyNotice}>
              {meta?.status === 'RISK_ASSESSMENT_PENDING'
                ? 'This questionnaire has been submitted and is under review. No further changes can be made.'
                : 'This questionnaire is currently read-only.'}
            </div>
          )}

          {/* Submission success */}
          {meta?.status === 'RISK_ASSESSMENT_PENDING' && (
            <div style={s.successNotice}>
              ✓ Questionnaire submitted. The Albatha Information Security Team will review your
              responses and be in touch.
            </div>
          )}

          {submitError && (
            <div style={s.errorBanner}>{submitError}</div>
          )}

          {fileError && (
            <div style={s.errorBanner}>{fileError}</div>
          )}

          {/* AI addendum indicator */}
          {meta?.is_ai_application && (
            <div style={s.aiNotice}>
              This engagement includes an <strong>AI Application Addendum</strong>. Additional
              questions (31–43) will appear after the standard questionnaire sections below.
            </div>
          )}

          {/* Sections */}
          {sections.map((section) => (
            <section key={section.name} style={s.section}>
              <div style={s.sectionHeader}>
                {section.isAI && (
                  <span
                    className="badge"
                    style={{ background: 'var(--blue-subtle)', color: 'var(--blue)', marginBottom: 6 }}
                  >
                    AI Addendum
                  </span>
                )}
                <h2 style={{ ...s.sectionTitle, color: section.isAI ? 'var(--blue)' : 'var(--accent)' }}>
                  {section.name}
                </h2>
              </div>

              <div className="card" style={s.sectionCard}>
                {section.questions.map((question, idx) => (
                  <React.Fragment key={question.id}>
                    {idx > 0 && <div style={s.questionDivider} />}
                    <div style={s.questionRow}>
                      <div style={s.questionMeta}>
                        <span style={s.questionNumber}>Q{question.question_number}</span>
                        {question.is_required && (
                          <span style={s.requiredDot} title="Required">*</span>
                        )}
                      </div>
                      <div style={s.questionBody}>
                        <p style={s.questionText}>{question.question_text}</p>

                        {question.response_type === 'FILE_UPLOAD' ? (
                          <QuestionFileZone
                            question={question}
                            files={files}
                            onUpload={handleFileUpload}
                            onDelete={handleFileDelete}
                            isReadOnly={!isEditable}
                            uploading={uploadingQuestion}
                          />
                        ) : (
                          <textarea
                            className="textarea"
                            style={{ ...s.textarea, ...(isEditable ? {} : s.textareaReadOnly) }}
                            value={responses[question.id]?.response_text ?? ''}
                            onChange={(e) => handleTextChange(question.id, e.target.value)}
                            placeholder={isEditable ? 'Enter your response…' : ''}
                            readOnly={!isEditable}
                            rows={4}
                          />
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </section>
          ))}

          {/* Attachments summary */}
          <div className="card" style={s.attachmentsCard}>
            <div style={s.attachmentsTitle}>
              <span>Attachments</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 400 }}>
                {totalFiles} / 20 files · {formatBytes(totalBytes)} / 100 MB
              </span>
            </div>
            {totalFiles === 0 ? (
              <p style={s.noAttachments}>No attachments uploaded.</p>
            ) : (
              <div style={s.attachmentsList}>
                {files.map((f) => (
                  <div key={f.id} style={s.attachmentRow}>
                    <span style={fzStyles.icon}>📎</span>
                    <span style={fzStyles.name}>{f.original_filename}</span>
                    <span style={fzStyles.size}>{formatBytes(f.file_size_bytes)}</span>
                    {isEditable && (
                      <button style={fzStyles.del} onClick={() => handleFileDelete(f.id)} title="Remove">×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit */}
          {isEditable && (
            <div style={s.submitRow}>
              <p style={s.submitHint}>
                Once submitted, the questionnaire will be locked and sent for review.
              </p>
              <button
                className="btn btn-primary"
                style={{ height: 38, padding: '0 24px' }}
                onClick={() => setShowSubmitModal(true)}
              >
                Submit questionnaire
              </button>
            </div>
          )}

          <p style={s.signedInAs}>
            Signed in as <strong>{email}</strong>
          </p>
        </div>
      </main>

      {/* Submit confirmation modal */}
      {showSubmitModal && (
        <SubmitModal
          onConfirm={handleSubmitConfirm}
          onCancel={() => setShowSubmitModal(false)}
          submitting={submitting}
        />
      )}
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const s = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-primary)',
  },
  loadPage: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border)',
    boxShadow: 'var(--shadow-sm)',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerInner: {
    maxWidth: 800,
    margin: '0 auto',
    padding: '0 24px',
    height: 52,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerLeft: {
    display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1,
  },
  wordmark: {
    fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--accent)',
    letterSpacing: '-0.01em', flexShrink: 0,
  },
  headerSep: { color: 'var(--border-strong)', flexShrink: 0 },
  headerPortal: {
    fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  headerRight: {
    display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
  },
  main: { flex: 1, padding: '32px 24px 64px' },
  content: {
    maxWidth: 760, margin: '0 auto',
    display: 'flex', flexDirection: 'column', gap: 24,
  },
  readOnlyNotice: {
    padding: '12px 16px',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
  },
  successNotice: {
    padding: '12px 16px',
    background: 'var(--risk-low-bg)',
    border: '1px solid var(--risk-low)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    color: 'var(--risk-low)',
    lineHeight: 1.6,
  },
  errorBanner: {
    padding: '10px 14px',
    background: 'var(--risk-high-bg)',
    border: '1px solid var(--risk-high)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    color: 'var(--risk-high)',
    lineHeight: 1.5,
  },
  aiNotice: {
    padding: '12px 16px',
    background: 'var(--blue-subtle)',
    border: '1px solid var(--blue)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    color: 'var(--blue)',
    lineHeight: 1.6,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 10 },
  sectionHeader: { display: 'flex', flexDirection: 'column', gap: 2 },
  sectionTitle: {
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  sectionCard: { padding: 0, overflow: 'hidden' },
  questionDivider: { height: 1, background: 'var(--border)' },
  questionRow: {
    display: 'flex', gap: 16, padding: '18px 20px',
  },
  questionMeta: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 4, flexShrink: 0, width: 32,
  },
  questionNumber: {
    fontSize: 'var(--text-xs)', fontWeight: 600,
    color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace',
    letterSpacing: '0.02em',
  },
  requiredDot: {
    color: 'var(--risk-medium)', fontSize: 14, lineHeight: 1,
  },
  questionBody: { flex: 1, display: 'flex', flexDirection: 'column', gap: 10 },
  questionText: {
    fontSize: 'var(--text-sm)', color: 'var(--text-primary)', lineHeight: 1.6,
  },
  textarea: {
    width: '100%', minHeight: 100,
    padding: '8px 10px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-sm)',
    fontFamily: 'inherit',
    resize: 'vertical', lineHeight: 1.5,
    outline: 'none',
    transition: 'border-color 150ms ease',
  },
  textareaReadOnly: {
    background: 'var(--bg-subtle)',
    color: 'var(--text-secondary)',
    cursor: 'default',
  },
  attachmentsCard: {
    padding: 0, overflow: 'hidden',
  },
  attachmentsTitle: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px',
    borderBottom: '1px solid var(--border)',
    fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)',
  },
  noAttachments: {
    padding: '16px 20px',
    fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
  },
  attachmentsList: {
    padding: '12px 20px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  attachmentRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 10px',
    background: 'var(--bg-subtle)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
  },
  submitRow: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: 16,
    padding: '20px 24px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
  },
  submitHint: {
    fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5,
  },
  signedInAs: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textAlign: 'center',
  },
}
