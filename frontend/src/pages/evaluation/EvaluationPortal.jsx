import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'
import EvaluationLogin from './EvaluationLogin'

// ─── helpers ────────────────────────────────────────────────────────────────

function apiFetch(path, token, options = {}) {
  return fetch(`${BASE_PATH}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
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
  DD_SENT_UNOPENED: 'Questionnaire Sent',
  DD_IN_PROGRESS: 'Questionnaire In Progress',
  RISK_ASSESSMENT_PENDING: 'Risk Assessment Pending',
  CLOSED: 'Closed',
  CLOSED_PENDING_IR_DOCS: 'Closed — Pending Documents',
  UNDER_REVIEW: 'Under Review',
}

const STATUS_COLORS = {
  DRAFT: 'var(--status-draft)',
  FUNCTIONAL_EVALUATION_PENDING: 'var(--status-ir-pending)',
  DD_SENT_UNOPENED: 'var(--status-dd-sent)',
  DD_IN_PROGRESS: 'var(--status-dd-progress)',
  RISK_ASSESSMENT_PENDING: 'var(--status-risk-pending)',
  CLOSED: 'var(--status-closed)',
  CLOSED_PENDING_IR_DOCS: 'var(--status-closed-pending)',
  UNDER_REVIEW: 'var(--status-under-review)',
}

const DOC_TYPES = [
  {
    key: 'IR_FUNCTIONAL_EVALUATION',
    label: 'Functional Evaluation',
    hint: 'Required — triggers questionnaire dispatch when uploaded',
    required: true,
  },
  {
    key: 'IR_NDA',
    label: 'NDA',
    hint: 'Non-disclosure agreement',
    required: false,
  },
  {
    key: 'IR_SOW',
    label: 'Statement of Work',
    hint: 'Scope and deliverables document',
    required: false,
  },
]

// ─── ThemeToggle ─────────────────────────────────────────────────────────────

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
    <button
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={themeToggleStyle}
    >
      {dark ? '☀' : '☾'}
    </button>
  )
}

const themeToggleStyle = {
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  fontSize: 15,
  cursor: 'pointer',
  transition: 'background 150ms ease, border-color 150ms ease',
  flexShrink: 0,
}

// ─── UploadZone ──────────────────────────────────────────────────────────────

function UploadZone({ docType, files, onUpload, onDelete, uploading }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const matching = files.filter((f) => f.file_type === docType.key)
  const totalSize = matching.reduce((s, f) => s + f.file_size_bytes, 0)

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length > 0) onUpload(docType.key, droppedFiles[0])
  }

  function handleInputChange(e) {
    const f = e.target.files?.[0]
    if (f) onUpload(docType.key, f)
    e.target.value = ''
  }

  return (
    <div style={uploadZoneStyles.wrapper}>
      <div style={uploadZoneStyles.header}>
        <div>
          <span style={uploadZoneStyles.label}>
            {docType.label}
            {docType.required && <span style={uploadZoneStyles.required}>*</span>}
          </span>
          <span style={uploadZoneStyles.hint}>{docType.hint}</span>
        </div>
        <button
          className="btn btn-secondary"
          style={{ fontSize: 'var(--text-xs)', height: 28, padding: '0 10px' }}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleInputChange}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg"
        />
      </div>

      {/* Drop zone */}
      <div
        style={{
          ...uploadZoneStyles.dropZone,
          borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
          background: dragOver ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        {uploading === docType.key ? (
          <span style={uploadZoneStyles.dropText}>Uploading…</span>
        ) : (
          <span style={uploadZoneStyles.dropText}>
            Drop file here or <span style={{ color: 'var(--accent)', fontWeight: 500 }}>browse</span>
          </span>
        )}
      </div>

      {/* Uploaded files */}
      {matching.length > 0 && (
        <div style={uploadZoneStyles.fileList}>
          {matching.map((f) => (
            <div key={f.id} style={uploadZoneStyles.fileRow}>
              <span style={uploadZoneStyles.fileIcon}>📄</span>
              <span style={uploadZoneStyles.fileName}>{f.original_filename}</span>
              <span style={uploadZoneStyles.fileSize}>{formatBytes(f.file_size_bytes)}</span>
              <button
                style={uploadZoneStyles.deleteBtn}
                onClick={() => onDelete(f.id)}
                title="Remove file"
              >
                ×
              </button>
            </div>
          ))}
          <span style={uploadZoneStyles.totals}>
            {matching.length} file{matching.length !== 1 ? 's' : ''} · {formatBytes(totalSize)}
          </span>
        </div>
      )}
    </div>
  )
}

const uploadZoneStyles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  label: {
    display: 'block',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    color: 'var(--text-primary)',
  },
  required: {
    color: 'var(--risk-high)',
    marginLeft: 3,
  },
  hint: {
    display: 'block',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    marginTop: 2,
    lineHeight: 1.5,
  },
  dropZone: {
    borderRadius: 'var(--radius-sm)',
    border: '1.5px dashed',
    padding: '14px 16px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 150ms ease, background 150ms ease',
  },
  dropText: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: 'var(--bg-subtle)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
  },
  fileIcon: {
    fontSize: 13,
    flexShrink: 0,
  },
  fileName: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileSize: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  deleteBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: 18,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 2px',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    transition: 'color 150ms ease',
  },
  totals: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    marginTop: 2,
  },
}

// ─── Main portal ─────────────────────────────────────────────────────────────

export default function EvaluationPortal() {
  const { token } = useParams()
  const { irSession, loginIR, logoutIR } = useAuth()

  const isAuthenticated = irSession && irSession.engagementToken === token

  if (!isAuthenticated) {
    return <EvaluationLogin token={token} onSuccess={loginIR} />
  }

  return <PortalContent token={token} session={irSession} onLogout={logoutIR} />
}

function PortalContent({ token, session, onLogout }) {
  const [engagement, setEngagement] = useState(null)
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(null)
  const [uploadError, setUploadError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/evaluation/engagements/${token}/status`, session.accessToken)
      if (res.status === 401 || res.status === 403) {
        onLogout()
        return
      }
      if (!res.ok) throw new Error('Failed to load engagement')
      const data = await res.json()
      setEngagement(data)
      setFiles(data.ir_documents || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token, session.accessToken, onLogout])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  async function handleUpload(fileType, file) {
    setUploadError('')
    setUploading(fileType)
    try {
      const form = new FormData()
      form.append('file_type', fileType)
      form.append('file', file)

      const res = await apiFetch(
        `/api/evaluation/engagements/${token}/files`,
        session.accessToken,
        { method: 'POST', body: form }
      )

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail || 'Upload failed')
      }

      showSaved('File uploaded')
      await fetchStatus()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(null)
    }
  }

  async function handleDelete(fileId) {
    setUploadError('')
    try {
      const res = await apiFetch(
        `/api/evaluation/engagements/${token}/files/${fileId}`,
        session.accessToken,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('Delete failed')
      showSaved('File removed')
      setFiles((prev) => prev.filter((f) => f.id !== fileId))
    } catch (err) {
      setUploadError(err.message)
    }
  }

  function showSaved(msg) {
    setSavedMsg(msg)
    setTimeout(() => setSavedMsg(''), 1500)
  }

  if (loading) {
    return (
      <div style={portalStyles.loadingPage}>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div style={portalStyles.loadingPage}>
        <span style={{ color: 'var(--risk-high)', fontSize: 'var(--text-sm)' }}>{error}</span>
      </div>
    )
  }

  const statusLabel = STATUS_LABELS[engagement?.status] || engagement?.status
  const statusColor = STATUS_COLORS[engagement?.status] || 'var(--text-muted)'

  return (
    <div style={portalStyles.page}>
      {/* Top header */}
      <header style={portalStyles.header}>
        <div style={portalStyles.headerInner}>
          <div style={portalStyles.headerLeft}>
            <span style={portalStyles.wordmark}>ISDD Portal</span>
            <span style={portalStyles.headerSep}>|</span>
            <span style={portalStyles.headerPortal}>IT Representative Portal</span>
          </div>
          <div style={portalStyles.headerRight}>
            {engagement && (
              <span
                className="badge"
                style={{ background: statusColor + '20', color: statusColor }}
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

      {/* Main content */}
      <main style={portalStyles.main}>
        <div style={portalStyles.content} className="fade-in">

          {/* Engagement info */}
          {engagement && (
            <div className="card" style={portalStyles.engagementCard}>
              <div style={portalStyles.engagementGrid}>
                <div style={portalStyles.engagementField}>
                  <span style={portalStyles.fieldLabel}>Document Number</span>
                  <span style={portalStyles.fieldValue}>{engagement.doc_number}</span>
                </div>
                <div style={portalStyles.engagementField}>
                  <span style={portalStyles.fieldLabel}>Application</span>
                  <span style={portalStyles.fieldValue}>{engagement.application_name}</span>
                </div>
                <div style={portalStyles.engagementField}>
                  <span style={portalStyles.fieldLabel}>Status</span>
                  <span
                    className="badge"
                    style={{ background: statusColor + '20', color: statusColor }}
                  >
                    {statusLabel}
                  </span>
                </div>
                {engagement.is_ai_application && (
                  <div style={portalStyles.engagementField}>
                    <span style={portalStyles.fieldLabel}>AI Application</span>
                    <span
                      className="badge"
                      style={{ background: 'var(--blue-subtle)', color: 'var(--blue)' }}
                    >
                      AI Addendum Required
                    </span>
                  </div>
                )}
              </div>

              {engagement.status === 'FUNCTIONAL_EVALUATION_PENDING' && (
                <div style={portalStyles.infoNotice}>
                  Upload the Functional Evaluation below to dispatch the vendor questionnaire.
                  NDA and SOW can be uploaded at any time.
                </div>
              )}
            </div>
          )}

          {/* Document upload panel */}
          <div className="card" style={portalStyles.docsCard}>
            <div style={portalStyles.cardTitle}>
              <span>Pre-DD Documents</span>
              {savedMsg && (
                <span style={portalStyles.savedMsg}>✓ {savedMsg}</span>
              )}
            </div>

            {uploadError && (
              <div style={portalStyles.uploadError}>{uploadError}</div>
            )}

            <div style={portalStyles.docList}>
              {DOC_TYPES.map((dt, i) => (
                <React.Fragment key={dt.key}>
                  {i > 0 && <div style={portalStyles.divider} />}
                  <UploadZone
                    docType={dt}
                    files={files}
                    onUpload={handleUpload}
                    onDelete={handleDelete}
                    uploading={uploading}
                  />
                </React.Fragment>
              ))}
            </div>

            <div style={portalStyles.fileStats}>
              <span>
                {files.length} / 20 files uploaded ·{' '}
                {formatBytes(files.reduce((s, f) => s + f.file_size_bytes, 0))} / 100 MB used
              </span>
            </div>
          </div>

          {/* Signed in as */}
          <p style={portalStyles.signedInAs}>
            Signed in as <strong>{session.email}</strong>
          </p>
        </div>
      </main>
    </div>
  )
}

const portalStyles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-primary)',
  },
  loadingPage: {
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
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  wordmark: {
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    color: 'var(--accent)',
    letterSpacing: '-0.01em',
    flexShrink: 0,
  },
  headerSep: {
    color: 'var(--border-strong)',
    flexShrink: 0,
  },
  headerPortal: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  main: {
    flex: 1,
    padding: '32px 24px 64px',
  },
  content: {
    maxWidth: 760,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  engagementCard: {
    padding: '20px 24px',
  },
  engagementGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '12px 20px',
  },
  engagementField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  fieldLabel: {
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  fieldValue: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    fontWeight: 500,
  },
  infoNotice: {
    marginTop: 16,
    padding: '10px 14px',
    background: 'var(--blue-subtle)',
    border: '1px solid var(--blue)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    color: 'var(--blue)',
    lineHeight: 1.6,
  },
  docsCard: {
    padding: 0,
    overflow: 'hidden',
  },
  cardTitle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderBottom: '1px solid var(--border)',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  savedMsg: {
    fontSize: 'var(--text-xs)',
    color: 'var(--risk-low)',
    animation: 'fadeIn 150ms ease',
  },
  uploadError: {
    margin: '12px 24px 0',
    padding: '8px 12px',
    background: 'var(--risk-high-bg)',
    border: '1px solid var(--risk-high)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    color: 'var(--risk-high)',
  },
  docList: {
    padding: '16px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  divider: {
    height: 1,
    background: 'var(--border)',
  },
  fileStats: {
    padding: '10px 24px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-subtle)',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
  },
  signedInAs: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
}
