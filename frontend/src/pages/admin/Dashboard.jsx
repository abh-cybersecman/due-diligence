import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'
import { DEFAULT_PAGE_SIZE } from '../../constants/pagination'

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

// Strip a trailing `-R{n}` suffix from a doc number for display in the
// engagements table. The R-chip differentiates revisions; the cell shows the
// root doc number only. Display-only — never apply elsewhere.
function stripRevisionSuffix(docNumber) {
  return (docNumber || '').replace(/-R\d+$/, '')
}

function captionFor(total) {
  return total === 1 ? '1 engagement family' : `${total} engagement families`
}

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
  const [expanded, setExpanded] = useState(() => new Set())

  const [sortDirection, setSortDirection] = useState('desc')
  const [ocs, setOcs] = useState([])
  const [ocFilter, setOcFilter] = useState('')
  const [dateField, setDateField] = useState('created')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const LIMIT = DEFAULT_PAGE_SIZE

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

  // Load OC list once on mount; the dropdown is otherwise stable across filter
  // changes (a new OC added in Settings shows up after a hard reload).
  useEffect(() => {
    apiFetch('/api/admin/settings/oc-list')
      .then(r => (r.ok ? r.json() : []))
      .then(list => {
        const sorted = [...(list || [])].sort((a, b) =>
          (a.name || '').localeCompare(b.name || '')
        )
        setOcs(sorted)
      })
      .catch(() => {})
  }, [apiFetch])

  const dateRangeInvalid = useMemo(() => {
    if (!dateFrom || !dateTo) return false
    return dateFrom > dateTo
  }, [dateFrom, dateTo])

  const loadEngagements = useCallback(async () => {
    if (dateRangeInvalid) {
      setItems([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)
    params.set('sort_direction', sortDirection)
    if (ocFilter) params.set('oc_id', ocFilter)
    if (dateFrom || dateTo) {
      params.set('date_field', dateField)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
    }
    params.set('limit', LIMIT)
    params.set('offset', offset)

    try {
      const res = await apiFetch(`/api/admin/engagements?${params}`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.items)
        setTotal(data.total)
      } else {
        setItems([])
        setTotal(0)
      }
    } catch {
      setItems([])
      setTotal(0)
    }
    setLoading(false)
  }, [
    apiFetch, statusFilter, search, offset, sortDirection,
    ocFilter, dateField, dateFrom, dateTo, dateRangeInvalid,
  ])

  useEffect(() => { loadEngagements() }, [loadEngagements])

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

  function toggleSortDirection() {
    setSortDirection(d => (d === 'desc' ? 'asc' : 'desc'))
    setOffset(0)
  }

  function clearFilters() {
    setSearchInput('')
    setSearch('')
    setStatusFilter('')
    setOcFilter('')
    setDateField('created')
    setDateFrom('')
    setDateTo('')
    setOffset(0)
  }

  const filtersActive =
    !!search || !!searchInput || !!statusFilter || !!ocFilter ||
    !!dateFrom || !!dateTo

  const pages = Math.ceil(total / LIMIT)
  const page = Math.floor(offset / LIMIT)

  return (
    <AdminLayout>
      <div className="fade-in">
        {/* Header */}
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Engagements</h1>
            <p style={s.subtitle}>{captionFor(total)}</p>
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
              style={{ width: 220 }}
              placeholder="Search by application name…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary">Search</button>
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

          <select
            className="input"
            style={{ width: 160 }}
            value={ocFilter}
            onChange={e => { setOcFilter(e.target.value); setOffset(0) }}
          >
            <option value="">All OCs</option>
            {ocs.map(oc => (
              <option key={oc.id} value={oc.id}>{oc.name}</option>
            ))}
          </select>

          <div style={s.dateGroup}>
            <select
              className="input"
              style={{ width: 150 }}
              value={dateField}
              onChange={e => { setDateField(e.target.value); setOffset(0) }}
            >
              <option value="created">Created date</option>
              <option value="submitted">Submitted date</option>
            </select>
            <label style={s.dateLabel}>From</label>
            <input
              type="date"
              className="input"
              style={{ width: 150 }}
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setOffset(0) }}
            />
            <label style={s.dateLabel}>To</label>
            <input
              type="date"
              className="input"
              style={{ width: 150 }}
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setOffset(0) }}
            />
          </div>

          {filtersActive && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>

        {dateRangeInvalid && (
          <div style={s.validationHint}>
            “From” date must be on or before the “To” date.
          </div>
        )}

        {/* Table */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <table style={s.table}>
            <thead>
              <tr style={s.thead}>
                <th style={{ ...s.th, width: 32 }}></th>
                <th
                  style={{ ...s.th, width: 180, ...s.thSortable }}
                  onClick={toggleSortDirection}
                  title="Toggle sort direction"
                >
                  <span style={s.thSortableInner}>
                    Document #
                    <span style={s.sortCaret}>{sortDirection === 'desc' ? '▼' : '▲'}</span>
                  </span>
                </th>
                <th style={s.th}>Application</th>
                <th style={s.th}>Operating Companies</th>
                <th style={{ ...s.th, width: 190 }}>Status</th>
                <th style={{ ...s.th, width: 110 }}>Created</th>
                <th style={{ ...s.th, width: 110 }}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={s.empty}>Loading…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} style={s.empty}>
                    {filtersActive ? (
                      <>
                        <div>No engagements match the current filters.</div>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ marginTop: 8 }}
                          onClick={clearFilters}
                        >
                          Clear filters
                        </button>
                      </>
                    ) : (
                      'No engagements yet. Create one to get started.'
                    )}
                  </td>
                </tr>
              ) : (
                items.map((eng, idx) => {
                  const revCount = eng.revision_count || 1
                  const grouped = revCount > 1
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
                            <span style={s.docNum}>{stripRevisionSuffix(eng.doc_number)}</span>
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
                                  <span style={{ ...s.docNum, color: 'var(--text-muted)' }}>{stripRevisionSuffix(rev.doc_number)}</span>
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
                })
              )}
            </tbody>
          </table>
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
    rowGap: 10,
    alignItems: 'center',
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  searchForm: { display: 'flex', gap: 8 },
  dateGroup: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  dateLabel: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  validationHint: {
    fontSize: 'var(--text-xs)',
    color: 'var(--risk-high)',
    marginTop: -6,
    marginBottom: 10,
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
  thSortable: {
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background-color 120ms ease',
  },
  thSortableInner: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  sortCaret: {
    fontSize: 10,
    color: 'var(--text-muted)',
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
