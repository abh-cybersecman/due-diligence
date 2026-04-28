import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'

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

const ALL_STATUSES = Object.keys(STATUS_LABELS)
const FLAT_VIEW_KEY = 'isdd_dashboard_flat_view'

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
  const [flatView, setFlatView] = useState(() => localStorage.getItem(FLAT_VIEW_KEY) === '1')
  const [expanded, setExpanded] = useState(() => new Set())
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
    params.set('group_by_family', flatView ? 'false' : 'true')
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
  }, [apiFetch, statusFilter, search, offset, flatView])

  useEffect(() => { loadEngagements() }, [loadEngagements])

  function toggleFlatView() {
    setFlatView(v => {
      const next = !v
      localStorage.setItem(FLAT_VIEW_KEY, next ? '1' : '0')
      setOffset(0)
      setExpanded(new Set())
      return next
    })
  }

  function toggleExpand(famId) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(famId)) next.delete(famId)
      else next.add(famId)
      return next
    })
  }

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
            <p style={s.subtitle}>{total} total {flatView ? 'engagement' : 'family'}{total !== 1 ? (flatView ? 's' : ' families') : ''}</p>
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
            {ALL_STATUSES.map(st => (
              <option key={st} value={st}>{STATUS_LABELS[st]}</option>
            ))}
          </select>

          <label style={s.flatToggle}>
            <input type="checkbox" checked={flatView} onChange={toggleFlatView} />
            Show all revisions as separate rows
          </label>
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
                  <th style={{ ...s.th, width: 32 }}></th>
                  <th style={{ ...s.th, width: 180 }}>Document #</th>
                  <th style={s.th}>Application</th>
                  <th style={s.th}>Operating Companies</th>
                  <th style={{ ...s.th, width: 190 }}>Status</th>
                  <th style={{ ...s.th, width: 110 }}>Created</th>
                  <th style={{ ...s.th, width: 110 }}>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {items.map((eng, idx) => {
                  const revCount = eng.revision_count || 1
                  const grouped = !flatView && revCount > 1
                  const isOpen = expanded.has(eng.id)
                  return (
                    <React.Fragment key={eng.id}>
                      <tr
                        style={{
                          ...s.tr,
                          background: idx % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)',
                        }}
                        onClick={() => navigate(`/admin/engagements/${eng.id}`)}
                      >
                        <td
                          style={s.td}
                          onClick={(e) => {
                            if (grouped) { e.stopPropagation(); toggleExpand(eng.id) }
                          }}
                        >
                          {grouped ? (
                            <span style={s.chevron}>
                              {isOpen ? '▾' : '▸'}
                            </span>
                          ) : null}
                        </td>
                        <td style={s.td}>
                          <div style={s.docCell}>
                            <span style={s.docNum}>{eng.doc_number}</span>
                            <div style={s.docBadgeRow}>
                              {eng.is_ai_application && (
                                <span style={s.aiBadge}>AI</span>
                              )}
                              {grouped && (
                                <span style={s.revBadge}>R{eng.revision_number}</span>
                              )}
                            </div>
                          </div>
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
                      {grouped && isOpen && (eng.revisions || [])
                        .filter(rev => rev.id !== eng.id)
                        .slice()
                        .reverse()
                        .map(rev => {
                          const isCancelled = rev.status === 'CANCELLED'
                          return (
                            <tr
                              key={rev.id}
                              style={{
                                ...s.tr,
                                background: 'var(--bg-muted)',
                                opacity: isCancelled ? 0.6 : 1,
                              }}
                              onClick={() => navigate(`/admin/engagements/${rev.id}`)}
                            >
                              <td style={s.td}></td>
                              <td style={{ ...s.td, paddingLeft: 28 }}>
                                <div style={s.docCell}>
                                  <span style={{ ...s.docNum, color: 'var(--text-muted)' }}>{rev.doc_number}</span>
                                  <div style={s.docBadgeRow}>
                                    <span style={s.revBadge}>R{rev.revision_number}</span>
                                    {isCancelled && <span style={s.cancelledBadge}>cancelled</span>}
                                  </div>
                                </div>
                              </td>
                              <td style={{ ...s.td, color: 'var(--text-muted)' }}>—</td>
                              <td style={{ ...s.td, color: 'var(--text-muted)' }}>—</td>
                              <td style={s.td}><StatusBadge status={rev.status} /></td>
                              <td style={{ ...s.td, color: 'var(--text-muted)' }}>—</td>
                              <td style={{ ...s.td, color: 'var(--text-muted)' }}>{formatDate(rev.submitted_at)}</td>
                            </tr>
                          )
                        })}
                    </React.Fragment>
                  )
                })}
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
  flatToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 'var(--text-xs)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    marginLeft: 'auto',
  },

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
  chevron: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-block',
    width: 12,
  },
  docCell: {
    display: 'flex', flexDirection: 'column', gap: 4,
    alignItems: 'flex-start',
  },
  docNum: {
    fontFamily: "'Geist Mono', monospace",
    fontSize: 'var(--text-xs)',
    color: 'var(--blue)',
    whiteSpace: 'nowrap',
  },
  docBadgeRow: {
    display: 'flex', gap: 6, flexWrap: 'wrap',
  },
  aiBadge: {
    fontSize: 'var(--text-xs)',
    background: 'var(--accent-subtle)',
    color: 'var(--accent)',
    borderRadius: 100,
    padding: '1px 6px',
    fontWeight: 600,
  },
  revBadge: {
    fontSize: 'var(--text-xs)',
    background: 'var(--bg-muted)',
    color: 'var(--text-secondary)',
    borderRadius: 100,
    padding: '1px 6px',
    fontWeight: 600,
    border: '1px solid var(--border)',
  },
  cancelledBadge: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
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
