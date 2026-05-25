import React, { useCallback, useEffect, useState } from 'react'
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

function captionFor(total) {
  return total === 1 ? '1 engagement' : `${total} engagements`
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

const EM_DASH = '—'

function Cell({ value, style, children }) {
  const display = children !== undefined
    ? children
    : (value === null || value === undefined || value === ''
        ? <span style={{ color: 'var(--text-muted)' }}>{EM_DASH}</span>
        : value)
  const tooltip =
    typeof value === 'string' && value
      ? value
      : (typeof children === 'string' ? children : undefined)
  return (
    <td
      style={{ ...s.td, ...style }}
      title={tooltip}
    >
      <div style={s.cellInner}>{display}</div>
    </td>
  )
}

export default function InventoryDashboard() {
  const { adminSession } = useAuth()
  const navigate = useNavigate()

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  const PAGE_SIZE = DEFAULT_PAGE_SIZE

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

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
      const res = await apiFetch(`/api/admin/dashboard/inventory?${params}`)
      if (!res.ok) {
        setError('Unable to load dashboard data.')
        setItems([])
        setTotal(0)
      } else {
        const data = await res.json()
        setItems(data.items || [])
        setTotal(data.total || 0)
      }
    } catch {
      setError('Unable to reach the server.')
      setItems([])
      setTotal(0)
    }
    setLoading(false)
  }, [apiFetch, page])

  useEffect(() => { load() }, [load])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <AdminLayout>
      <div className="fade-in">
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Dashboard</h1>
            <p style={s.subtitle}>{captionFor(total)}</p>
          </div>
        </div>

        {error && <div style={s.errorBanner}>{error}</div>}

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr style={s.thead}>
                <th style={s.th}>Document #</th>
                <th style={s.th}>Application</th>
                <th style={s.th}>Operating Companies</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Service Type</th>
                <th style={s.th}>Hosting</th>
                <th style={s.th}>Hyperscaler</th>
                <th style={s.th}>DR</th>
                <th style={s.th}>DR Location</th>
                <th style={s.th}>Data Residency</th>
                <th style={s.th}>Enc. at Rest</th>
                <th style={s.th}>Enc. in Transit</th>
                <th style={s.th}>MFA</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} style={s.empty}>Loading…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={13} style={s.empty}>
                    <div>No engagements yet.</div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ marginTop: 12 }}
                      onClick={() => navigate('/admin/engagements/new')}
                    >
                      + New Engagement
                    </button>
                  </td>
                </tr>
              ) : (
                items.map((row, idx) => {
                  const sf = row.structured_fields || {}
                  const ocText = (row.operating_companies || []).join(', ')
                  const isCancelled = row.status === 'CANCELLED'
                  const mutedStyle = isCancelled ? { color: 'var(--text-muted)' } : undefined
                  return (
                    <tr
                      key={row.engagement_id}
                      style={{
                        ...s.tr,
                        background: idx % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)',
                      }}
                      className="inventory-row"
                    >
                      <td style={s.td}>
                        <div style={s.docCell}>
                          <a
                            href={`#`}
                            onClick={(e) => {
                              e.preventDefault()
                              navigate(`/admin/engagements/${row.engagement_id}`)
                            }}
                            style={{
                              ...s.docLink,
                              ...(isCancelled ? { color: 'var(--text-muted)' } : null),
                            }}
                          >
                            {row.doc_number_root}
                          </a>
                          <div style={s.docBadgeRow}>
                            {row.is_ai_application && <span style={s.aiBadge}>AI</span>}
                            {row.revision_label && row.revision_label !== 'R0' && (
                              <span style={s.revBadge}>{row.revision_label}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <Cell value={row.application_name} style={{ fontWeight: 500, ...mutedStyle }} />
                      <Cell value={ocText} style={mutedStyle} />
                      <td style={s.td} title={STATUS_LABELS[row.status] || row.status}>
                        <div style={s.cellInner}>
                          <StatusBadge status={row.status} />
                        </div>
                      </td>
                      <Cell value={sf.service_type} style={mutedStyle} />
                      <Cell value={sf.hosting_location} style={mutedStyle} />
                      <Cell value={sf.hyperscaler} style={mutedStyle} />
                      <Cell value={sf.disaster_recovery} style={mutedStyle} />
                      <Cell value={sf.dr_location} style={mutedStyle} />
                      <Cell value={sf.data_residency_region} style={mutedStyle} />
                      <Cell value={sf.encryption_at_rest} style={mutedStyle} />
                      <Cell value={sf.encryption_in_transit} style={mutedStyle} />
                      <Cell value={sf.mfa_supported} style={mutedStyle} />
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div style={s.pagination}>
            <button
              className="btn btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <span style={s.pageInfo}>Page {page} of {pages}</span>
            <button
              className="btn btn-secondary"
              disabled={page >= pages}
              onClick={() => setPage(p => Math.min(pages, p + 1))}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      <style>{`
        .inventory-row:hover td { background: var(--accent-subtle) !important; }
      `}</style>
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

  errorBanner: {
    fontSize: 'var(--text-sm)',
    color: 'var(--risk-high)',
    background: 'var(--risk-high-bg)',
    border: '1px solid var(--risk-high)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    marginBottom: 12,
  },

  tableWrap: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    overflowX: 'auto',
    overflowY: 'visible',
  },

  table: {
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
    tableLayout: 'auto',
  },
  thead: { background: 'var(--bg-subtle)' },
  th: {
    padding: '9px 10px',
    textAlign: 'left',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    background: 'var(--bg-subtle)',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  },
  tr: {
    transition: 'background-color 120ms ease',
  },
  td: {
    padding: '11px 10px',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'middle',
    maxWidth: 280,
  },
  cellInner: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  docCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    alignItems: 'flex-start',
    minWidth: 0,
  },
  docLink: {
    fontFamily: "'Geist Mono', monospace",
    fontSize: 'var(--text-xs)',
    color: 'var(--blue)',
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  docBadgeRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
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
