import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'

const STATUS_LABELS = {
  DRAFT: 'Draft',
  FUNCTIONAL_EVALUATION_PENDING: 'IR Docs Pending',
  PENDING_DISPATCH: 'Pending Dispatch',
  DD_SENT_UNOPENED: 'DD Sent',
  DD_IN_PROGRESS: 'DD In Progress',
  RISK_ASSESSMENT_PENDING: 'Risk Pending',
  CLOSED: 'Closed',
  CLOSED_PENDING_IR_DOCS: 'Closed — Pending Docs',
  UNDER_REVIEW: 'Under Review',
}

const STATUS_COLORS = {
  DRAFT: 'var(--status-draft)',
  FUNCTIONAL_EVALUATION_PENDING: 'var(--status-ir-pending)',
  PENDING_DISPATCH: 'var(--status-pending-dispatch)',
  DD_SENT_UNOPENED: 'var(--status-dd-sent)',
  DD_IN_PROGRESS: 'var(--status-dd-progress)',
  RISK_ASSESSMENT_PENDING: 'var(--status-risk-pending)',
  CLOSED: 'var(--status-closed)',
  CLOSED_PENDING_IR_DOCS: 'var(--status-closed-pending)',
  UNDER_REVIEW: 'var(--status-under-review)',
}

const ALL_STATUSES = Object.keys(STATUS_LABELS)

function StatusBadge({ status }) {
  return (
    <span
      className="badge"
      style={{
        background: 'transparent',
        border: `1px solid ${STATUS_COLORS[status] || 'var(--border)'}`,
        color: STATUS_COLORS[status] || 'var(--text-muted)',
      }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function Dashboard() {
  const { adminSession } = useAuth()
  const navigate = useNavigate()

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [offset, setOffset] = useState(0)
  const LIMIT = 50

  const apiFetch = useCallback(
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

  const loadEngagements = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    params.set('limit', LIMIT)
    params.set('offset', offset)

    try {
      const res = await apiFetch(`/api/admin/engagements?${params}`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.items)
        setTotal(data.total)
      }
    } catch {}
    setLoading(false)
  }, [apiFetch, statusFilter, search, offset])

  useEffect(() => { loadEngagements() }, [loadEngagements])

  function handleSearch(e) {
    e.preventDefault()
    setSearch(searchInput)
    setOffset(0)
  }

  function handleStatusChange(v) {
    setStatusFilter(v)
    setOffset(0)
  }

  const pages = Math.ceil(total / LIMIT)
  const page = Math.floor(offset / LIMIT)

  return (
    <AdminLayout>
      <div className="fade-in">
        {/* Header */}
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Engagements</h1>
            <p style={s.subtitle}>{total} total engagement{total !== 1 ? 's' : ''}</p>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/admin/engagements/new')}>
            + New Engagement
          </button>
        </div>

        {/* Filters */}
        <div style={s.filters}>
          <form onSubmit={handleSearch} style={s.searchForm}>
            <input
              className="input"
              style={{ width: 240 }}
              placeholder="Search by application name…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary">Search</button>
            {search && (
              <button type="button" className="btn btn-ghost" onClick={() => { setSearch(''); setSearchInput(''); setOffset(0) }}>
                Clear
              </button>
            )}
          </form>

          <select
            className="input"
            style={{ width: 180 }}
            value={statusFilter}
            onChange={e => handleStatusChange(e.target.value)}
          >
            <option value="">All statuses</option>
            {ALL_STATUSES.map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="card" style={{ overflow: 'hidden' }}>
          {loading ? (
            <div style={s.empty}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={s.empty}>
              {search || statusFilter ? 'No engagements match your filters.' : 'No engagements yet. Create one to get started.'}
            </div>
          ) : (
            <table style={s.table}>
              <thead>
                <tr style={s.thead}>
                  <th style={{ ...s.th, width: 160 }}>Document #</th>
                  <th style={s.th}>Application</th>
                  <th style={s.th}>Operating Companies</th>
                  <th style={{ ...s.th, width: 190 }}>Status</th>
                  <th style={{ ...s.th, width: 110 }}>Created</th>
                  <th style={{ ...s.th, width: 110 }}>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {items.map((eng, idx) => (
                  <tr
                    key={eng.id}
                    style={{
                      ...s.tr,
                      background: idx % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)',
                    }}
                    onClick={() => navigate(`/admin/engagements/${eng.id}`)}
                  >
                    <td style={s.td}>
                      <span style={s.docNum}>{eng.doc_number}</span>
                      {eng.is_ai_application && <span style={s.aiBadge}>AI</span>}
                    </td>
                    <td style={s.td}>
                      <span style={s.appName}>{eng.application_name}</span>
                    </td>
                    <td style={{ ...s.td, color: 'var(--text-secondary)' }}>
                      {eng.operating_companies.length > 0
                        ? eng.operating_companies.map(oc => oc.name).join(', ')
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={s.td}><StatusBadge status={eng.status} /></td>
                    <td style={{ ...s.td, color: 'var(--text-secondary)' }}>{formatDate(eng.created_at)}</td>
                    <td style={{ ...s.td, color: 'var(--text-secondary)' }}>{formatDate(eng.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div style={s.pagination}>
            <button
              className="btn btn-secondary"
              disabled={page === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            >
              ← Prev
            </button>
            <span style={s.pageInfo}>Page {page + 1} of {pages}</span>
            <button
              className="btn btn-secondary"
              disabled={page >= pages - 1}
              onClick={() => setOffset(offset + LIMIT)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

const s = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  title: { fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)' },
  subtitle: { fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 3 },

  filters: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  searchForm: { display: 'flex', gap: 8 },

  table: { width: '100%', borderCollapse: 'collapse' },
  thead: { background: 'var(--bg-subtle)' },
  th: {
    padding: '9px 16px',
    textAlign: 'left',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  tr: {
    cursor: 'pointer',
    transition: 'background-color 120ms ease',
  },
  td: {
    padding: '11px 16px',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'middle',
  },
  docNum: {
    fontFamily: "'Geist Mono', monospace",
    fontSize: 'var(--text-xs)',
    color: 'var(--blue)',
    marginRight: 6,
  },
  aiBadge: {
    fontSize: 'var(--text-xs)',
    background: 'var(--accent-subtle)',
    color: 'var(--accent)',
    borderRadius: 100,
    padding: '1px 6px',
    fontWeight: 600,
  },
  appName: { fontWeight: 500 },

  empty: {
    padding: '48px',
    textAlign: 'center',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
  },

  pagination: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    justifyContent: 'center',
    marginTop: 16,
  },
  pageInfo: { fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' },
}
