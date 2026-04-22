import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'
import MultiSelectDropdown from '../../components/shared/MultiSelectDropdown'

// ── Shared helpers ─────────────────────────────────────────────────────────────

function useApiFetch() {
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

const STATUS_LABELS = {
  DRAFT: 'Draft',
  FUNCTIONAL_EVALUATION_PENDING: 'IR Docs Pending',
  PENDING_DISPATCH: 'Pending Dispatch',
  DD_IN_PROGRESS: 'DD In Progress',
  RISK_ASSESSMENT_PENDING: 'Risk Assessment Pending',
  CLOSED: 'Closed',
  PENDING_CLOSURE: 'Pending Closure',
  UNDER_REVIEW: 'Under Review',
  CANCELLED: 'Cancelled',
}
const STATUS_COLORS = {
  DRAFT: 'var(--status-draft)',
  FUNCTIONAL_EVALUATION_PENDING: 'var(--status-ir-pending)',
  PENDING_DISPATCH: 'var(--status-pending-dispatch)',
  DD_IN_PROGRESS: 'var(--status-dd-progress)',
  RISK_ASSESSMENT_PENDING: 'var(--status-risk-pending)',
  CLOSED: 'var(--status-closed)',
  PENDING_CLOSURE: 'var(--status-closed-pending)',
  UNDER_REVIEW: 'var(--status-under-review)',
  CANCELLED: 'var(--status-cancelled)',
}
const RISK_LABELS = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' }
const RISK_COLORS = {
  CRITICAL: 'var(--risk-critical)',
  HIGH: 'var(--risk-high)',
  MEDIUM: 'var(--risk-medium)',
  LOW: 'var(--risk-low)',
}

function StatusBadge({ status }) {
  return (
    <span className="badge" style={{ border: `1px solid ${STATUS_COLORS[status] || 'var(--border)'}`, color: STATUS_COLORS[status] || 'var(--text-muted)' }}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

function RiskBadge({ rating }) {
  if (!rating) return null
  return (
    <span className="badge" style={{ background: 'transparent', border: `1px solid ${RISK_COLORS[rating]}`, color: RISK_COLORS[rating] }}>
      {RISK_LABELS[rating]}
    </span>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function SaveConfirm({ show }) {
  if (!show) return null
  return (
    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--status-closed)', marginLeft: 8 }}>
      ✓ Saved
    </span>
  )
}

function AIButton({ label, tooltip }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn btn-secondary"
        disabled
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{ cursor: 'not-allowed', opacity: 0.5 }}
      >
        {label}
      </button>
      {show && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--text-primary)',
          color: 'var(--bg-surface)',
          padding: '5px 10px',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--text-xs)',
          whiteSpace: 'nowrap',
          zIndex: 100,
          pointerEvents: 'none',
          boxShadow: 'var(--shadow-md)',
        }}>
          {tooltip}
        </div>
      )}
    </div>
  )
}

// ── Cancel engagement modal ────────────────────────────────────────────────────

function CancelEngagementModal({ engagement, apiFetch, onSuccess, onClose }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!password) { setError('Password is required'); return }
    setSubmitting(true)
    setError('')
    try {
      const res = await apiFetch(`/api/admin/engagements/${engagement.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      if (res.status === 403) { setError('Incorrect password'); return }
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.detail || 'Cancel failed'); return }
      onSuccess()
    } finally {
      setSubmitting(false)
    }
  }

  return ReactDOM.createPortal(
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.dialog} onClick={e => e.stopPropagation()}>
        <h3 style={modalStyles.title}>Cancel Engagement</h3>
        <p style={modalStyles.body}>
          You are about to cancel{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{engagement.doc_number} — {engagement.application_name}</strong>.
          {' '}This will halt the engagement at its current stage. Enter your admin password to confirm.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Admin password"
            className="input"
            style={{ width: '100%' }}
          />
          {error && <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--risk-high)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Back</button>
            <button type="submit" className="btn btn-danger" disabled={submitting}>
              {submitting ? 'Cancelling…' : 'Cancel Engagement'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ engagement, apiFetch, onRefresh }) {
  const [sf, setSf] = useState(null)
  const [sfForm, setSfForm] = useState({})
  const [sfSaving, setSfSaving] = useState(false)
  const [sfSaved, setSfSaved] = useState(false)
  const [allOcs, setAllOcs] = useState([])
  const [ocEdit, setOcEdit] = useState(false)
  const [ocDraft, setOcDraft] = useState([])
  const [ocSaving, setOcSaving] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)

  const loadSf = useCallback(async () => {
    const res = await apiFetch(`/api/admin/engagements/${engagement.id}/structured-fields`)
    if (res.ok) {
      const data = await res.json()
      setSf(data)
      setSfForm(data || {})
    } else {
      setSf(null)
      setSfForm({})
    }
  }, [apiFetch, engagement.id])

  useEffect(() => { loadSf() }, [loadSf])

  useEffect(() => {
    apiFetch('/api/admin/settings/oc-list').then(r => r.ok ? r.json() : []).then(setAllOcs)
  }, [apiFetch])

  async function saveOcs() {
    const names = allOcs.filter(o => ocDraft.includes(o.id)).map(o => o.name)
    if (!window.confirm(`Update operating companies to:\n${names.length > 0 ? names.join('\n') : '(none)'}?\n\nThis will update the engagement record.`)) return
    setOcSaving(true)
    const res = await apiFetch(`/api/admin/engagements/${engagement.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ operating_company_ids: ocDraft }),
    })
    if (res.ok) { setOcEdit(false); onRefresh() }
    setOcSaving(false)
  }

  async function saveSf() {
    setSfSaving(true)
    const res = await apiFetch(`/api/admin/engagements/${engagement.id}/structured-fields`, {
      method: 'PATCH',
      body: JSON.stringify(sfForm),
    })
    if (res.ok) {
      setSf(await res.json())
      setSfSaved(true)
      setTimeout(() => setSfSaved(false), 1500)
    }
    setSfSaving(false)
  }

  async function handleReopenCancelled() {
    if (!window.confirm(
      `Reopen "${engagement.application_name}" and return it to Draft?\n\nThe engagement can then progress through the lifecycle again.`
    )) return
    const res = await apiFetch(`/api/admin/engagements/${engagement.id}/reopen-from-cancelled`, {
      method: 'POST',
      body: '{}',
    })
    if (res.ok) onRefresh()
  }

  const SF_FIELDS = [
    { key: 'service_type', label: 'Service Type' },
    { key: 'hosting_location', label: 'Hosting Location' },
    { key: 'hyperscaler', label: 'Hyperscaler' },
    { key: 'disaster_recovery', label: 'Disaster Recovery' },
    { key: 'dr_location', label: 'DR Location' },
    { key: 'data_residency_region', label: 'Data Residency Region' },
    { key: 'encryption_at_rest', label: 'Encryption at Rest' },
    { key: 'encryption_in_transit', label: 'Encryption in Transit' },
    { key: 'mfa_supported', label: 'MFA Supported' },
  ]

  return (
    <div style={s.tabContent}>
      {/* Engagement info */}
      <div className="card" style={s.panel}>
        <div style={s.panelHeader}>
          <h3 style={s.panelTitle}>Engagement Details</h3>
        </div>
        <div style={s.panelBody}>
          <div style={s.infoGrid}>
            <InfoRow label="Document Number" value={<span style={s.mono}>{engagement.doc_number}</span>} />
            <InfoRow label="Application" value={engagement.application_name} />
            {ocEdit ? (
              <div style={s.infoRow}>
                <span style={s.infoLabel}>Operating Companies</span>
                <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <MultiSelectDropdown
                      items={allOcs}
                      value={ocDraft}
                      onChange={setOcDraft}
                      placeholder="Select operating companies…"
                    />
                  </div>
                  <button className="btn btn-primary" onClick={saveOcs} disabled={ocSaving} style={{ height: 30, padding: '0 10px', fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                    {ocSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => setOcEdit(false)} style={{ height: 30, padding: '0 10px', fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={s.infoRow}>
                <span style={s.infoLabel}>Operating Companies</span>
                <span style={{ ...s.infoValue, display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <span>{engagement.operating_companies.map(o => o.name).join(', ') || '—'}</span>
                  <button
                    onClick={() => { setOcDraft(engagement.operating_companies.map(o => o.id)); setOcEdit(true) }}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1px 7px', fontSize: 'var(--text-xs)', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
                  >
                    Edit
                  </button>
                </span>
              </div>
            )}
            <InfoRow label="AI Application" value={engagement.is_ai_application ? 'Yes' : 'No'} />
            <EmailEditRow
              label="Vendor Emails"
              emails={engagement.vendor_emails}
              onSave={async (emails) => {
                const res = await apiFetch(`/api/admin/engagements/${engagement.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ vendor_emails: emails }),
                })
                if (res.ok) onRefresh()
              }}
            />
            <EmailEditRow
              label="IR Emails"
              emails={engagement.ir_emails}
              onSave={async (emails) => {
                const res = await apiFetch(`/api/admin/engagements/${engagement.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ ir_emails: emails }),
                })
                if (res.ok) onRefresh()
              }}
            />
            <TokenRow label="Vendor Token" token={engagement.vendor_token} urlPath="/respond" />
            <TokenRow label="IR Token" token={engagement.ir_token} urlPath="/evaluation" />
            <InfoRow label="Created" value={formatDate(engagement.created_at)} />
            <InfoRow label="Submitted" value={formatDate(engagement.submitted_at)} />
          </div>
          {engagement.internal_notes && (
            <div style={s.notes}>
              <div style={s.notesLabel}>Internal Notes</div>
              <div style={s.notesText}>{engagement.internal_notes}</div>
            </div>
          )}
        </div>
      </div>

      {/* Cancel / Reopen engagement */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 0' }}>
        {engagement.status === 'CANCELLED' ? (
          <button className="btn btn-secondary" onClick={handleReopenCancelled}>
            Reopen DD
          </button>
        ) : (
          <button className="btn btn-danger" onClick={() => setShowCancelModal(true)}>
            Cancel Engagement
          </button>
        )}
      </div>

      {/* Structured fields */}
      <div className="card" style={s.panel}>
        <div style={s.panelHeader}>
          <h3 style={s.panelTitle}>Structured Fields</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <AIButton label="Extract with AI" tooltip="AI extraction coming in a future phase" />
            <button className="btn btn-primary" onClick={saveSf} disabled={sfSaving} style={{ height: 30, padding: '0 12px', fontSize: 'var(--text-xs)' }}>
              {sfSaving ? 'Saving…' : 'Save'}
            </button>
            <SaveConfirm show={sfSaved} />
          </div>
        </div>
        <div style={s.panelBody}>
          <div style={s.sfGrid}>
            {SF_FIELDS.map(({ key, label }) => (
              <div key={key} style={s.sfField}>
                <label style={s.sfLabel}>{label}</label>
                <input
                  className="input"
                  value={sfForm[key] || ''}
                  onChange={e => setSfForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder="—"
                  style={{ height: 30, fontSize: 'var(--text-sm)' }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCancelModal && (
        <CancelEngagementModal
          engagement={engagement}
          apiFetch={apiFetch}
          onSuccess={() => { setShowCancelModal(false); onRefresh() }}
          onClose={() => setShowCancelModal(false)}
        />
      )}
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div style={s.infoRow}>
      <span style={s.infoLabel}>{label}</span>
      <span style={s.infoValue}>{value}</span>
    </div>
  )
}

function EmailEditRow({ label, emails, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState([])
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  function startEdit() {
    setDraft([...emails])
    setInput('')
    setError('')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function addEmail() {
    const val = input.trim().toLowerCase()
    if (!val) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) { setError('Invalid email address'); return }
    if (draft.includes(val)) { setError('Already in list'); return }
    setDraft(d => [...d, val])
    setInput('')
    setError('')
  }

  function removeEmail(email) {
    setDraft(d => d.filter(e => e !== email))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); addEmail() }
    if (e.key === 'Escape') cancel()
  }

  function cancel() {
    setEditing(false)
    setInput('')
    setError('')
  }

  async function save() {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div style={s.infoRow}>
        <span style={s.infoLabel}>{label}</span>
        <span style={{ ...s.infoValue, display: 'flex', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' }}>
          <span>{emails.length > 0 ? emails.join(', ') : '—'}</span>
          <button
            onClick={startEdit}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '1px 7px', fontSize: 'var(--text-xs)', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}
          >
            Edit
          </button>
        </span>
      </div>
    )
  }

  return (
    <div style={s.infoRow}>
      <span style={s.infoLabel}>{label}</span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {draft.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {draft.map(email => (
              <span key={email} style={emailChipStyle}>
                {email}
                <button onClick={() => removeEmail(email)} style={emailChipRemoveStyle} title="Remove">×</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            ref={inputRef}
            className="input"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            onKeyDown={handleKeyDown}
            placeholder="email@example.com"
            style={{ height: 28, fontSize: 'var(--text-sm)', flex: 1, minWidth: 0 }}
          />
          <button className="btn btn-secondary" onClick={addEmail} style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)', flexShrink: 0 }}>Add</button>
          <button className="btn btn-primary" onClick={save} disabled={saving} style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)', flexShrink: 0 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-secondary" onClick={cancel} style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)', flexShrink: 0 }}>Cancel</button>
        </div>
        {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--risk-high)' }}>{error}</span>}
      </div>
    </div>
  )
}

const emailChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px 2px 8px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 100,
  fontSize: 'var(--text-xs)',
  color: 'var(--text-primary)',
}

const emailChipRemoveStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
}

function TokenRow({ label, token, urlPath }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    const base = (localStorage.getItem('isdd_portal_base_url') || window.location.origin).replace(/\/$/, '')
    const url = `${base}${BASE_PATH}${urlPath}/${token}`

    function markCopied() {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }

    function fallback() {
      const el = document.createElement('textarea')
      el.value = url
      el.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
      document.body.appendChild(el)
      el.select()
      try { document.execCommand('copy'); markCopied() } catch {}
      document.body.removeChild(el)
    }

    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(markCopied).catch(fallback)
    } else {
      fallback()
    }
  }

  return (
    <div style={s.infoRow}>
      <span style={s.infoLabel}>{label}</span>
      <span style={{ ...s.infoValue, display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span style={s.mono}>{token}</span>
        <button
          onClick={copy}
          style={{
            background: 'none',
            border: `1px solid ${copied ? 'var(--status-closed)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-sm)',
            padding: '1px 8px',
            fontSize: 'var(--text-xs)',
            cursor: 'pointer',
            color: copied ? 'var(--status-closed)' : 'var(--text-muted)',
            transition: 'color 150ms ease, border-color 150ms ease',
            flexShrink: 0,
          }}
        >
          {copied ? '✓ Copied' : 'Copy Link'}
        </button>
      </span>
    </div>
  )
}

// ── Risk Assessment tab ───────────────────────────────────────────────────────

function RiskTab({ engagementId, apiFetch, onEngagementRefresh }) {
  const [ra, setRa] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [assignees, setAssignees] = useState([])
  const [form, setForm] = useState({ overall_rating: '', summary: '', risk_items: [] })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const loadRa = useCallback(async () => {
    const res = await apiFetch(`/api/admin/engagements/${engagementId}/risk-assessment`)
    if (res.status === 404) { setNotFound(true); return }
    if (res.ok) {
      const data = await res.json()
      setRa(data)
      setNotFound(false)
      setForm({
        overall_rating: data.overall_rating || '',
        summary: data.summary || '',
        risk_items: data.risk_items.map(i => ({ ...i })),
      })
    }
  }, [apiFetch, engagementId])

  useEffect(() => {
    apiFetch('/api/admin/settings/assignees').then(r => r.ok ? r.json() : []).then(setAssignees)
    loadRa()
  }, [loadRa, apiFetch])

  async function createRa() {
    const res = await apiFetch(`/api/admin/engagements/${engagementId}/risk-assessment`, { method: 'POST', body: '{}' })
    if (res.ok) loadRa()
  }

  async function saveRa() {
    setSaving(true); setError('')
    const payload = {
      overall_rating: form.overall_rating || null,
      summary: form.summary || null,
      risk_items: form.risk_items.map((item, idx) => ({ ...item, order: idx })),
    }
    const res = await apiFetch(`/api/admin/engagements/${engagementId}/risk-assessment`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const data = await res.json()
      setRa(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.detail || 'Failed to save.')
    }
    setSaving(false)
  }

  async function finalise() {
    setError('')
    const res = await apiFetch(`/api/admin/engagements/${engagementId}/risk-assessment/finalise`, { method: 'POST', body: '{}' })
    if (res.ok) { loadRa(); onEngagementRefresh?.() }
    else { const d = await res.json().catch(() => ({})); setError(d.detail || 'Failed to finalise.') }
  }

  async function reopen() {
    const res = await apiFetch(`/api/admin/engagements/${engagementId}/risk-assessment/reopen`, { method: 'POST', body: '{}' })
    if (res.ok) loadRa()
  }

  function addItem() {
    setForm(f => ({ ...f, risk_items: [...f.risk_items, { description: '', rating: 'HIGH', assigned_to: [], mitigation: '', order: f.risk_items.length }] }))
  }

  function updateItem(idx, field, value) {
    setForm(f => {
      const items = [...f.risk_items]
      items[idx] = { ...items[idx], [field]: value }
      return { ...f, risk_items: items }
    })
  }

  function removeItem(idx) {
    setForm(f => ({ ...f, risk_items: f.risk_items.filter((_, i) => i !== idx) }))
  }

  const isFinalised = ra?.status === 'FINALISED'

  if (notFound) {
    return (
      <div style={s.tabContent}>
        <div className="card" style={s.panel}>
          <div style={s.panelBody}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 16 }}>
              No risk assessment has been created for this engagement yet.
            </p>
            <button className="btn btn-primary" onClick={createRa}>Create Risk Assessment</button>
          </div>
        </div>
      </div>
    )
  }

  if (!ra) return <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading…</div>

  return (
    <div style={s.tabContent}>
      <div className="card" style={s.panel}>
        <div style={s.panelHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h3 style={s.panelTitle}>Risk Assessment</h3>
            <span className="badge" style={{
              background: isFinalised ? 'var(--status-closed)' : 'var(--bg-muted)',
              color: isFinalised ? '#fff' : 'var(--text-muted)',
              border: 'none',
            }}>
              {isFinalised ? 'Finalised' : 'Draft'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!isFinalised && (
              <>
                <AIButton label="Generate with AI" tooltip="AI risk assessment coming in a future phase" />
                <button className="btn btn-secondary" onClick={saveRa} disabled={saving} style={{ height: 30, padding: '0 12px', fontSize: 'var(--text-xs)' }}>
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                <button className="btn btn-primary" onClick={finalise} style={{ height: 30, padding: '0 12px', fontSize: 'var(--text-xs)' }}>
                  Finalise
                </button>
              </>
            )}
            {isFinalised && (
              <button className="btn btn-secondary" onClick={reopen} style={{ height: 30, padding: '0 12px', fontSize: 'var(--text-xs)' }}>
                Reopen
              </button>
            )}
            <SaveConfirm show={saved} />
          </div>
        </div>

        {error && <div style={{ ...s.errorBar, margin: '0 20px 12px' }}>{error}</div>}

        <div style={s.panelBody}>
          {/* Overall rating + summary */}
          <div style={s.raTopGrid}>
            <div style={s.sfField}>
              <label style={s.sfLabel}>Overall Risk Rating</label>
              <select
                className="input"
                value={form.overall_rating}
                onChange={e => setForm(f => ({ ...f, overall_rating: e.target.value }))}
                disabled={isFinalised}
                style={{ height: 30, fontSize: 'var(--text-sm)' }}
              >
                <option value="">— Not set —</option>
                {Object.keys(RISK_LABELS).map(r => (
                  <option key={r} value={r}>{RISK_LABELS[r]}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={s.sfLabel}>Executive Summary</label>
            <textarea
              className="textarea"
              value={form.summary}
              onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
              disabled={isFinalised}
              placeholder="Summarise the overall risk posture of this vendor engagement…"
              rows={3}
              style={{ marginTop: 4, fontSize: 'var(--text-sm)' }}
            />
          </div>

          {/* Risk items */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                Risk Register ({form.risk_items.length} item{form.risk_items.length !== 1 ? 's' : ''})
              </label>
              {!isFinalised && (
                <button className="btn btn-secondary" onClick={addItem} style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)' }}>
                  + Add Item
                </button>
              )}
            </div>

            {form.risk_items.length === 0 ? (
              <div style={s.emptyItems}>No risk items yet. {!isFinalised && 'Add items using the button above.'}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {form.risk_items.map((item, idx) => (
                  <RiskItemRow
                    key={idx}
                    item={item}
                    idx={idx}
                    disabled={isFinalised}
                    assignees={assignees}
                    onChange={(field, val) => updateItem(idx, field, val)}
                    onRemove={() => removeItem(idx)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RiskItemRow({ item, idx, disabled, assignees, onChange, onRemove }) {
  const [asnOpen, setAsnOpen] = useState(false)
  const asnRef = useRef(null)

  useEffect(() => {
    function outside(e) { if (asnRef.current && !asnRef.current.contains(e.target)) setAsnOpen(false) }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  function toggleAssignee(name) {
    const cur = item.assigned_to || []
    onChange('assigned_to', cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name])
  }

  return (
    <div style={s.riskItemCard}>
      <div style={s.riskItemHeader}>
        <span style={s.riskItemNum}>#{idx + 1}</span>
        {!disabled && (
          <button onClick={onRemove} style={s.removeBtn} title="Remove item">×</button>
        )}
      </div>
      <div style={s.riskItemGrid}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={s.sfLabel}>Description</label>
          <textarea
            className="textarea"
            value={item.description}
            onChange={e => onChange('description', e.target.value)}
            disabled={disabled}
            placeholder="Describe the risk…"
            rows={2}
            style={{ marginTop: 3, fontSize: 'var(--text-sm)' }}
          />
        </div>

        <div>
          <label style={s.sfLabel}>Rating</label>
          <select
            className="input"
            value={item.rating}
            onChange={e => onChange('rating', e.target.value)}
            disabled={disabled}
            style={{ marginTop: 3, height: 30, fontSize: 'var(--text-sm)', color: RISK_COLORS[item.rating] }}
          >
            {Object.keys(RISK_LABELS).map(r => <option key={r} value={r}>{RISK_LABELS[r]}</option>)}
          </select>
        </div>

        <div ref={asnRef} style={{ position: 'relative' }}>
          <label style={s.sfLabel}>Assigned To</label>
          <div
            style={{ ...s.asnBox, marginTop: 3, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'default' : 'pointer' }}
            onClick={() => !disabled && setAsnOpen(o => !o)}
          >
            {(item.assigned_to || []).length === 0
              ? <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Select…</span>
              : (item.assigned_to || []).map(n => (
                  <span key={n} style={s.asnChip}>{n}</span>
                ))}
          </div>
          {asnOpen && !disabled && (
            <div style={s.asnDropdown}>
              {assignees.length === 0
                ? <div style={s.asnEmpty}>No assignees configured.</div>
                : assignees.map(a => (
                    <div
                      key={a.id}
                      style={{ ...s.asnOption, background: (item.assigned_to || []).includes(a.name) ? 'var(--accent-subtle)' : 'transparent' }}
                      onClick={() => toggleAssignee(a.name)}
                    >
                      {(item.assigned_to || []).includes(a.name) && <span style={{ color: 'var(--accent)', marginRight: 6 }}>✓</span>}
                      <span>{a.name}</span>
                      {a.type_label && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginLeft: 6 }}>{a.type_label}</span>}
                    </div>
                  ))}
            </div>
          )}
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label style={s.sfLabel}>Mitigation</label>
          <textarea
            className="textarea"
            value={item.mitigation}
            onChange={e => onChange('mitigation', e.target.value)}
            disabled={disabled}
            placeholder="Recommended mitigation action…"
            rows={2}
            style={{ marginTop: 3, fontSize: 'var(--text-sm)' }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Responses tab ─────────────────────────────────────────────────────────────

function ResponsesTab({ engagementId, apiFetch }) {
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(`/api/admin/engagements/${engagementId}/responses`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setResponses(data); setLoading(false) })
  }, [apiFetch, engagementId])

  if (loading) return <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading…</div>

  if (responses.length === 0) {
    return (
      <div style={s.tabContent}>
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          No questionnaire responses yet.
        </div>
      </div>
    )
  }

  // Group by section
  const sections = {}
  const order = []
  for (const r of responses) {
    if (!sections[r.section]) { sections[r.section] = []; order.push(r.section) }
    sections[r.section].push(r)
  }

  return (
    <div style={s.tabContent}>
      {order.map(section => (
        <div key={section} className="card" style={{ ...s.panel, marginBottom: 16 }}>
          <div style={s.panelHeader}>
            <h3 style={{ ...s.panelTitle, color: 'var(--blue)' }}>{section}</h3>
          </div>
          <div style={s.panelBody}>
            {sections[section].map(r => (
              <div key={r.id} style={s.responseItem}>
                <div style={s.qText}><strong>Q{r.question_number}.</strong> {r.question_text}</div>
                <div style={s.answerText}>
                  {r.response_text || (r.selected_options?.length ? r.selected_options.join(', ') : <em style={{ color: 'var(--text-muted)' }}>No response</em>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Audit tab ─────────────────────────────────────────────────────────────────

function AuditTab({ engagementId, apiFetch }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const LIMIT = 50

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/admin/engagements/${engagementId}/audit?limit=${LIMIT}&offset=${offset}`)
    if (res.ok) { const d = await res.json(); setItems(d.items); setTotal(d.total) }
  }, [apiFetch, engagementId, offset])

  useEffect(() => { load() }, [load])

  const pages = Math.ceil(total / LIMIT)
  const page = Math.floor(offset / LIMIT)

  return (
    <div style={s.tabContent}>
      <div className="card" style={{ overflow: 'hidden' }}>
        {items.length === 0 ? (
          <div style={s.empty}>No audit entries yet.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle)' }}>
                <th style={s.th}>Time</th>
                <th style={s.th}>Actor</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Action</th>
                <th style={s.th}>Description</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} style={{ background: idx % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)' }}>
                  <td style={s.td}><span style={s.mono}>{new Date(item.created_at).toLocaleString('en-GB')}</span></td>
                  <td style={s.td}>{item.actor}</td>
                  <td style={s.td}><span style={s.actorType}>{item.actor_type}</span></td>
                  <td style={{ ...s.td, ...s.mono }}>{item.action}</td>
                  <td style={{ ...s.td, color: 'var(--text-secondary)' }}>{item.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div style={s.pagination}>
          <button className="btn btn-secondary" disabled={page === 0} onClick={() => setOffset(o => Math.max(0, o - LIMIT))}>← Prev</button>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Page {page + 1} of {pages}</span>
          <button className="btn btn-secondary" disabled={page >= pages - 1} onClick={() => setOffset(o => o + LIMIT)}>Next →</button>
        </div>
      )}
    </div>
  )
}

// ── Files tab ─────────────────────────────────────────────────────────────────

const FILE_TYPE_LABELS = {
  IR_FUNCTIONAL_EVALUATION: 'Functional Evaluation',
  IR_NDA: 'NDA',
  IR_SOW: 'Statement of Work',
  VENDOR_ATTACHMENT: 'Vendor Attachment',
}

const IR_TYPES = ['IR_FUNCTIONAL_EVALUATION', 'IR_NDA', 'IR_SOW']

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function DeleteFileModal({ file, engagementId, apiFetch, onSuccess, onClose }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!password) { setError('Password is required'); return }
    setSubmitting(true)
    setError('')
    try {
      const res = await apiFetch(`/api/admin/engagements/${engagementId}/files/${file.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ password }),
      })
      if (res.status === 403) { setError('Incorrect password'); return }
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.detail || 'Delete failed'); return }
      onSuccess(file.id)
    } finally {
      setSubmitting(false)
    }
  }

  return ReactDOM.createPortal(
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.dialog} onClick={e => e.stopPropagation()}>
        <h3 style={modalStyles.title}>Delete File</h3>
        <p style={modalStyles.body}>
          You are about to permanently delete{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{file.original_filename}</strong>.
          This cannot be undone. Enter your admin password to confirm.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Admin password"
            className="input"
            style={{ width: '100%' }}
          />
          {error && <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--risk-high)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={submitting}>
              {submitting ? 'Deleting…' : 'Delete File'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

const modalStyles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
  },
  dialog: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', padding: '24px', width: 420, maxWidth: '90vw',
    boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', gap: 16,
  },
  title: { margin: 0, fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--text-primary)' },
  body: { margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 },
}

function FilesTab({ engagementId, apiFetch }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const loadFiles = useCallback(() => {
    apiFetch(`/api/admin/engagements/${engagementId}/files`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setFiles(data); setLoading(false) })
  }, [apiFetch, engagementId])

  useEffect(() => { loadFiles() }, [loadFiles])

  async function download(file) {
    setDownloading(file.id)
    const res = await apiFetch(`/api/admin/engagements/${engagementId}/files/${file.id}`)
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.original_filename
      a.click()
      URL.revokeObjectURL(url)
    }
    setDownloading(null)
  }

  function handleDeleteSuccess(fileId) {
    setFiles(prev => prev.filter(f => f.id !== fileId))
    setDeleteTarget(null)
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading…</div>

  const irFiles = files.filter(f => IR_TYPES.includes(f.file_type))
  const vendorFiles = files.filter(f => f.file_type === 'VENDOR_ATTACHMENT')

  function FileTable({ items, emptyMsg }) {
    if (items.length === 0) return (
      <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{emptyMsg}</div>
    )
    return (
      <table style={s.table}>
        <thead>
          <tr style={{ background: 'var(--bg-subtle)' }}>
            <th style={s.th}>Type</th>
            <th style={s.th}>Filename</th>
            <th style={s.th}>Size</th>
            <th style={s.th}>Uploaded By</th>
            <th style={s.th}>Date</th>
            <th style={s.th}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((f, idx) => (
            <tr key={f.id} style={{ background: idx % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)' }}>
              <td style={s.td}>
                <span style={{ fontSize: 'var(--text-xs)', padding: '2px 7px', borderRadius: 100, background: 'var(--bg-muted)', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  {FILE_TYPE_LABELS[f.file_type] || f.file_type}
                </span>
              </td>
              <td style={{ ...s.td, ...s.mono, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_filename}</td>
              <td style={{ ...s.td, color: 'var(--text-secondary)' }}>{formatBytes(f.file_size_bytes)}</td>
              <td style={{ ...s.td, color: 'var(--text-secondary)' }}>{f.uploaded_by}</td>
              <td style={{ ...s.td, color: 'var(--text-secondary)' }}>{formatDate(f.uploaded_at)}</td>
              <td style={{ ...s.td, textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ height: 26, padding: '0 10px', fontSize: 'var(--text-xs)' }}
                    onClick={() => download(f)}
                    disabled={downloading === f.id}
                  >
                    {downloading === f.id ? '…' : 'Download'}
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ height: 26, padding: '0 10px', fontSize: 'var(--text-xs)' }}
                    onClick={() => setDeleteTarget(f)}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <>
      {deleteTarget && (
        <DeleteFileModal
          file={deleteTarget}
          engagementId={engagementId}
          apiFetch={apiFetch}
          onSuccess={handleDeleteSuccess}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      <div style={s.tabContent}>
        <div className="card" style={{ ...s.panel, marginBottom: 16 }}>
          <div style={s.panelHeader}>
            <h3 style={s.panelTitle}>IR Documents</h3>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{irFiles.length} file{irFiles.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ overflow: 'hidden' }}>
            <FileTable items={irFiles} emptyMsg="No IR documents uploaded yet." />
          </div>
        </div>

        <div className="card" style={{ ...s.panel, marginBottom: 0 }}>
          <div style={s.panelHeader}>
            <h3 style={s.panelTitle}>Vendor Attachments</h3>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{vendorFiles.length} file{vendorFiles.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ overflow: 'hidden' }}>
            <FileTable items={vendorFiles} emptyMsg="No vendor attachments uploaded yet." />
          </div>
        </div>
      </div>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'risk', label: 'Risk Assessment' },
  { key: 'responses', label: 'Responses' },
  { key: 'files', label: 'Files' },
  { key: 'audit', label: 'Audit Log' },
]

export default function EngagementDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const apiFetch = useApiFetch()
  const { adminSession } = useAuth()

  const [engagement, setEngagement] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [actionError, setActionError] = useState('')

  const loadEngagement = useCallback(async () => {
    const res = await apiFetch(`/api/admin/engagements/${id}`)
    if (res.ok) setEngagement(await res.json())
    setLoading(false)
  }, [apiFetch, id])

  useEffect(() => { loadEngagement() }, [loadEngagement])

  async function handleExport() {
    const res = await fetch(`${BASE_PATH}/api/admin/engagements/${id}/export`, {
      headers: { Authorization: `Bearer ${adminSession?.accessToken}` },
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${engagement?.doc_number || 'export'}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function doAction(type) {
    setActionError('')
    let res
    if (type === 'advance') res = await apiFetch(`/api/admin/engagements/${id}/advance`, { method: 'POST', body: '{}' })
    else if (type === 'dispatch') {
      const filesRes = await apiFetch(`/api/admin/engagements/${id}/files`)
      const files = filesRes.ok ? await filesRes.json() : []
      const hasFE = files.some(f => f.file_type === 'IR_FUNCTIONAL_EVALUATION')
      if (!hasFE && !window.confirm('No functional evaluation has been uploaded.\n\nDispatch the questionnaire to the vendor anyway?')) return
      res = await apiFetch(`/api/admin/engagements/${id}/dispatch`, { method: 'POST', body: '{}' })
    }
    else if (type === 'reopen-dd') res = await apiFetch(`/api/admin/engagements/${id}/reopen`, { method: 'POST', body: '{}' })
    else if (type === 'close-questionnaire') res = await apiFetch(`/api/admin/engagements/${id}/close-questionnaire`, { method: 'POST', body: '{}' })
    else if (type === 'under-review') res = await apiFetch(`/api/admin/engagements/${id}/set-status`, { method: 'POST', body: JSON.stringify({ status: 'UNDER_REVIEW' }) })
    else if (type === 'close') res = await apiFetch(`/api/admin/engagements/${id}/set-status`, { method: 'POST', body: JSON.stringify({ status: 'CLOSED' }) })
    else if (type === 'close-from-pending') res = await apiFetch(`/api/admin/engagements/${id}/close-from-pending`, { method: 'POST', body: '{}' })
    else if (type === 'smart-close') res = await apiFetch(`/api/admin/engagements/${id}/close`, { method: 'POST', body: '{}' })

    if (res && !res.ok) {
      const d = await res.json().catch(() => ({}))
      setActionError(d.detail || 'Action failed.')
    } else {
      loadEngagement()
    }
  }

  if (loading) return <AdminLayout><div style={{ padding: 48, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading…</div></AdminLayout>
  if (!engagement) return <AdminLayout><div style={{ padding: 48, color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Engagement not found.</div></AdminLayout>

  const st = engagement.status

  return (
    <AdminLayout>
      <div className="fade-in">
        {/* Breadcrumb */}
        <button className="btn btn-ghost" style={{ marginBottom: 12, color: 'var(--text-muted)', padding: 0 }} onClick={() => navigate('/admin/dashboard')}>
          ← Engagements
        </button>

        {/* Header */}
        <div style={s.engHeader}>
          <div style={s.engHeaderLeft}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={s.mono2}>{engagement.doc_number}</span>
              <StatusBadge status={engagement.status} />
            </div>
            <h1 style={s.engTitle}>{engagement.application_name}</h1>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
              {engagement.operating_companies.map(o => o.name).join(' · ') || 'No operating companies'}
            </div>
          </div>
          <div style={s.engHeaderActions}>
            {st === 'DRAFT' && (
              <button className="btn btn-primary" onClick={() => doAction('advance')}>Advance to IR Stage</button>
            )}
            {st === 'PENDING_DISPATCH' && (
              <button className="btn btn-primary" onClick={() => doAction('dispatch')}>Dispatch to Vendor</button>
            )}
            {st === 'DD_IN_PROGRESS' && (
              <button className="btn btn-secondary" onClick={() => doAction('close-questionnaire')}>Close Questionnaire</button>
            )}
            {st === 'RISK_ASSESSMENT_PENDING' && (
              <button className="btn btn-secondary" onClick={() => doAction('reopen-dd')}>Reopen Questionnaire</button>
            )}
            {(st === 'CLOSED' || st === 'PENDING_CLOSURE') && (
              <button className="btn btn-secondary" onClick={() => doAction('under-review')}>Move to Under Review</button>
            )}
            {st === 'PENDING_CLOSURE' && (
              <button className="btn btn-primary" onClick={() => doAction('close-from-pending')}>Close Engagement</button>
            )}
            {st === 'UNDER_REVIEW' && (
              <button className="btn btn-primary" onClick={() => doAction('smart-close')}>Close Engagement</button>
            )}
            <button className="btn btn-secondary" onClick={handleExport}>Export Word</button>
          </div>
        </div>

        {actionError && <div style={{ ...s.errorBar, marginBottom: 12 }}>{actionError}</div>}

        {/* Tabs */}
        <div style={s.tabBar}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={activeTab === tab.key ? 'tab-btn tab-btn--active' : 'tab-btn'}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'overview' && <OverviewTab engagement={engagement} apiFetch={apiFetch} onRefresh={loadEngagement} />}
        {activeTab === 'risk' && <RiskTab engagementId={id} apiFetch={apiFetch} onEngagementRefresh={loadEngagement} />}
        {activeTab === 'responses' && <ResponsesTab engagementId={id} apiFetch={apiFetch} />}
        {activeTab === 'files' && <FilesTab engagementId={id} apiFetch={apiFetch} />}
        {activeTab === 'audit' && <AuditTab engagementId={id} apiFetch={apiFetch} />}
      </div>
    </AdminLayout>
  )
}

const s = {
  // ─ header
  engHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  engHeaderLeft: {},
  engHeaderActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  mono2: { fontFamily: "'Geist Mono', monospace", fontSize: 'var(--text-sm)', color: 'var(--blue)' },
  engTitle: { fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--text-primary)' },

  errorBar: {
    fontSize: 'var(--text-sm)',
    color: 'var(--risk-high)',
    background: 'var(--risk-high-bg)',
    border: '1px solid var(--risk-high)',
    borderRadius: 'var(--radius-sm)',
    padding: '9px 14px',
  },

  // ─ tabs
  tabBar: { display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16, gap: 0 },
  tabBtn: {
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    padding: '8px 16px',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'color 150ms ease',
    marginBottom: -1,
  },
  tabBtnActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },

  // ─ tab content
  tabContent: { display: 'flex', flexDirection: 'column', gap: 0 },

  // ─ panels
  panel: { overflow: 'hidden', marginBottom: 16 },
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 20px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-subtle)',
  },
  panelTitle: { fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' },
  panelBody: { padding: '16px 20px' },

  // ─ info grid
  infoGrid: { display: 'flex', flexDirection: 'column', gap: 0 },
  infoRow: { display: 'flex', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 16 },
  infoLabel: { width: 180, flexShrink: 0, fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)' },
  infoValue: { fontSize: 'var(--text-sm)', color: 'var(--text-primary)' },
  mono: { fontFamily: "'Geist Mono', monospace", fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' },

  notes: { marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' },
  notesLabel: { fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  notesText: { fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' },

  // ─ structured fields
  sfGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px 16px' },
  sfField: {},
  sfLabel: { fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 },

  // ─ risk assessment
  raTopGrid: { display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 },
  riskItemCard: {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: 14,
    background: 'var(--bg-subtle)',
  },
  riskItemHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 10 },
  riskItemNum: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 600 },
  removeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    fontSize: 18,
    lineHeight: 1,
    padding: 0,
    transition: 'color 150ms ease',
  },
  riskItemGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' },
  emptyItems: { fontSize: 'var(--text-sm)', color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' },

  // ─ assignee dropdown
  asnBox: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    padding: '4px 8px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface)',
    minHeight: 30,
    alignItems: 'center',
  },
  asnChip: {
    background: 'var(--accent-subtle)',
    color: 'var(--accent)',
    borderRadius: 100,
    padding: '1px 7px',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
  },
  asnDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-md)',
    zIndex: 50,
    marginTop: 2,
    maxHeight: 200,
    overflowY: 'auto',
  },
  asnOption: {
    display: 'flex',
    alignItems: 'center',
    padding: '7px 12px',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer',
    transition: 'background-color 120ms ease',
  },
  asnEmpty: { padding: '12px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' },

  // ─ responses
  responseItem: { marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)' },
  qText: { fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.5 },
  answerText: { fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, marginLeft: 16 },

  // ─ audit
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '8px 14px',
    textAlign: 'left',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: '9px 14px',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'top',
  },
  actorType: {
    fontSize: 'var(--text-xs)',
    padding: '2px 6px',
    borderRadius: 100,
    background: 'var(--bg-muted)',
    color: 'var(--text-muted)',
  },
  pagination: { display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginTop: 12 },
  empty: { padding: 40, textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' },
}
