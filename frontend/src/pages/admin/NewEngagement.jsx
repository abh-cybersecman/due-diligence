import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'

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

// Chip-style tag input for email lists
function EmailTagInput({ label, value, onChange, placeholder }) {
  const [draft, setDraft] = useState('')

  function commit() {
    const email = draft.trim().toLowerCase()
    if (email && !value.includes(email)) onChange([...value, email])
    setDraft('')
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() }
    if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div style={s.field}>
      <label style={s.label}>{label}</label>
      <div style={s.tagBox}>
        {value.map(email => (
          <span key={email} style={s.chip}>
            {email}
            <button
              type="button"
              style={s.chipRemove}
              onClick={() => onChange(value.filter(e => e !== email))}
            >×</button>
          </span>
        ))}
        <input
          style={s.tagInput}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </div>
      <span style={s.hint}>Press Enter or comma to add each address</span>
    </div>
  )
}

export default function NewEngagement() {
  const apiFetch = useAdminFetch()
  const navigate = useNavigate()

  const [ocs, setOcs] = useState([])
  const [form, setForm] = useState({
    application_name: '',
    operating_company_ids: [],
    vendor_emails: [],
    ir_emails: [],
    is_ai_application: false,
    internal_notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/admin/settings/oc-list').then(r => r.ok ? r.json() : []).then(setOcs)
  }, [apiFetch])

  function toggleOC(id) {
    setForm(f => ({
      ...f,
      operating_company_ids: f.operating_company_ids.includes(id)
        ? f.operating_company_ids.filter(x => x !== id)
        : [...f.operating_company_ids, id],
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.application_name.trim()) { setError('Application name is required.'); return }
    if (form.vendor_emails.length === 0) { setError('At least one vendor email is required.'); return }
    if (form.ir_emails.length === 0) { setError('At least one IR email is required.'); return }
    setSaving(true)
    try {
      const res = await apiFetch('/api/admin/engagements', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || 'Failed to create engagement.')
        return
      }
      const data = await res.json()
      navigate(`/admin/engagements/${data.id}`)
    } catch {
      setError('Unable to reach the server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout>
      <div className="fade-in" style={{ maxWidth: 640 }}>
        <div style={s.pageHeader}>
          <button className="btn btn-ghost" style={{ marginBottom: 8, color: 'var(--text-muted)' }} onClick={() => navigate('/admin/dashboard')}>
            ← Back
          </button>
          <h1 style={s.pageTitle}>New Engagement</h1>
          <p style={s.pageDesc}>Create a new Information Security Due Diligence engagement.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="card" style={s.formCard}>
            <div style={s.formSection}>
              <div style={s.field}>
                <label style={s.label} htmlFor="app_name">Application Name <span style={s.required}>*</span></label>
                <input
                  id="app_name"
                  className="input"
                  value={form.application_name}
                  onChange={e => setForm(f => ({ ...f, application_name: e.target.value }))}
                  placeholder="e.g. Salesforce CRM"
                  required
                  autoFocus
                />
              </div>

              <div style={s.field}>
                <label style={s.label}>Operating Companies</label>
                <div style={s.checkList}>
                  {ocs.length === 0 && (
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                      No operating companies configured. Add them in Settings first.
                    </span>
                  )}
                  {ocs.map(oc => (
                    <label key={oc.id} style={s.checkItem}>
                      <input
                        type="checkbox"
                        checked={form.operating_company_ids.includes(oc.id)}
                        onChange={() => toggleOC(oc.id)}
                        style={{ marginRight: 8 }}
                      />
                      {oc.name}
                    </label>
                  ))}
                </div>
              </div>

              <EmailTagInput
                label="Vendor Email Addresses *"
                value={form.vendor_emails}
                onChange={v => setForm(f => ({ ...f, vendor_emails: v }))}
                placeholder="vendor@example.com"
              />

              <EmailTagInput
                label="IT Representative Email Addresses *"
                value={form.ir_emails}
                onChange={v => setForm(f => ({ ...f, ir_emails: v }))}
                placeholder="ir@albatha.com"
              />

              <div style={s.field}>
                <label style={s.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={form.is_ai_application}
                    onChange={e => setForm(f => ({ ...f, is_ai_application: e.target.checked }))}
                    style={{ marginRight: 8 }}
                  />
                  AI Application (include AI addendum in questionnaire)
                </label>
              </div>

              <div style={s.field}>
                <label style={s.label} htmlFor="notes">Internal Notes</label>
                <textarea
                  id="notes"
                  className="textarea"
                  value={form.internal_notes}
                  onChange={e => setForm(f => ({ ...f, internal_notes: e.target.value }))}
                  placeholder="Internal context, background, or comments visible only to the IS team."
                  rows={4}
                />
              </div>
            </div>
          </div>

          {error && <div style={s.error}>{error}</div>}

          <div style={s.actions}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/admin/dashboard')}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create Engagement'}
            </button>
          </div>
        </form>
      </div>
    </AdminLayout>
  )
}

const s = {
  pageHeader: { marginBottom: 24 },
  pageTitle: { fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)' },
  pageDesc: { fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 },

  formCard: { padding: 0, overflow: 'hidden', marginBottom: 16 },
  formSection: { padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 },

  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)' },
  required: { color: 'var(--risk-high)' },
  hint: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)' },

  checkList: { display: 'flex', flexDirection: 'column', gap: 6 },
  checkItem: { display: 'flex', alignItems: 'center', fontSize: 'var(--text-sm)', cursor: 'pointer' },
  checkboxLabel: { display: 'flex', alignItems: 'center', fontSize: 'var(--text-sm)', cursor: 'pointer', color: 'var(--text-primary)' },

  tagBox: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface)',
    minHeight: 38,
    cursor: 'text',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'var(--accent-subtle)',
    color: 'var(--accent)',
    borderRadius: 100,
    padding: '2px 8px',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
  },
  chipRemove: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'inherit',
    lineHeight: 1,
    padding: 0,
    fontSize: 14,
  },
  tagInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    minWidth: 140,
    flex: 1,
  },

  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  error: {
    fontSize: 'var(--text-sm)',
    color: 'var(--risk-high)',
    background: 'var(--risk-high-bg)',
    border: '1px solid var(--risk-high)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 14px',
    marginBottom: 12,
  },
}
