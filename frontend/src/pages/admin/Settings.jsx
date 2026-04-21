import React, { useCallback, useEffect, useState } from 'react'
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

// ── Generic CRUD section ──────────────────────────────────────────────────────

function CrudSection({ title, description, items, loading, onAdd, onEdit, onDelete, renderItem, addForm }) {
  return (
    <section style={s.section}>
      <div style={s.sectionHeader}>
        <div>
          <h2 style={s.sectionTitle}>{title}</h2>
          {description && <p style={s.sectionDesc}>{description}</p>}
        </div>
        {onAdd && (
          <button className="btn btn-primary" onClick={onAdd} style={{ flexShrink: 0 }}>
            + Add
          </button>
        )}
      </div>

      {addForm}

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={s.emptyState}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={s.emptyState}>No entries yet.</div>
        ) : (
          <table style={s.table}>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} style={{ background: idx % 2 === 1 ? 'var(--bg-subtle)' : 'var(--bg-surface)' }}>
                  {renderItem(item)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

// ── Portal Base URL ───────────────────────────────────────────────────────────

function PortalURLSection() {
  const [url, setUrl] = useState(() =>
    localStorage.getItem('isdd_portal_base_url') || window.location.origin
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(url)
    setEditing(true)
  }

  function save() {
    const trimmed = draft.replace(/\/$/, '').trim()
    if (!trimmed) return
    localStorage.setItem('isdd_portal_base_url', trimmed)
    setUrl(trimmed)
    setEditing(false)
  }

  return (
    <section style={s.section}>
      <div style={s.sectionHeader}>
        <div>
          <h2 style={s.sectionTitle}>Portal Base URL</h2>
          <p style={s.sectionDesc}>
            Base URL prepended when copying vendor and IR portal share links from engagement details.
          </p>
        </div>
        {!editing && (
          <button className="btn btn-secondary" onClick={startEdit} style={{ flexShrink: 0 }}>
            Edit
          </button>
        )}
      </div>
      <div className="card" style={{ padding: '14px 20px' }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="input"
              style={{ flex: 1 }}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="https://vendorportal.albatha.com"
              onKeyDown={e => e.key === 'Enter' && save()}
              autoFocus
            />
            <button className="btn btn-primary" onClick={save} disabled={!draft.trim()}>Save</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {url}
          </span>
        )}
      </div>
    </section>
  )
}

// ── OC List ───────────────────────────────────────────────────────────────────

function OCSection({ apiFetch }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/admin/settings/oc-list')
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }, [apiFetch])

  useEffect(() => { load() }, [load])

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    const res = await apiFetch('/api/admin/settings/oc-list', {
      method: 'POST',
      body: JSON.stringify({ name: newName.trim() }),
    })
    if (res.ok) {
      setNewName('')
      setAdding(false)
      load()
    }
    setSaving(false)
  }

  async function handleUpdate(id) {
    if (!editName.trim()) return
    setSaving(true)
    const res = await apiFetch(`/api/admin/settings/oc-list/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: editName.trim() }),
    })
    if (res.ok) { setEditId(null); load() }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this operating company?')) return
    await apiFetch(`/api/admin/settings/oc-list/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <CrudSection
      title="Operating Companies"
      description="Companies that can be associated with engagements."
      items={items}
      loading={loading}
      onAdd={() => setAdding(true)}
      addForm={
        adding && (
          <div style={s.addForm}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Operating company name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              autoFocus
            />
            <button className="btn btn-primary" onClick={handleAdd} disabled={saving || !newName.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setAdding(false); setNewName('') }}>
              Cancel
            </button>
          </div>
        )
      }
      renderItem={item => (
        <>
          <td style={s.td}>
            {editId === item.id ? (
              <input
                className="input"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleUpdate(item.id)}
                autoFocus
                style={{ maxWidth: 320 }}
              />
            ) : (
              <span style={s.itemName}>{item.name}</span>
            )}
          </td>
          <td style={{ ...s.td, ...s.tdActions }}>
            {editId === item.id ? (
              <>
                <button className="btn btn-primary" style={s.actionBtn} onClick={() => handleUpdate(item.id)} disabled={saving}>Save</button>
                <button className="btn btn-secondary" style={s.actionBtn} onClick={() => setEditId(null)}>Cancel</button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost" style={s.actionBtn} onClick={() => { setEditId(item.id); setEditName(item.name) }}>Edit</button>
                <button className="btn btn-ghost" style={{ ...s.actionBtn, color: 'var(--risk-high)' }} onClick={() => handleDelete(item.id)}>Delete</button>
              </>
            )}
          </td>
        </>
      )}
    />
  )
}

// ── Assignees ─────────────────────────────────────────────────────────────────

function AssigneeSection({ apiFetch }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/admin/settings/assignees')
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }, [apiFetch])

  useEffect(() => { load() }, [load])

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    const res = await apiFetch('/api/admin/settings/assignees', {
      method: 'POST',
      body: JSON.stringify({ name: newName.trim(), type_label: newLabel.trim() || null }),
    })
    if (res.ok) { setNewName(''); setNewLabel(''); setAdding(false); load() }
    setSaving(false)
  }

  async function handleUpdate(id) {
    setSaving(true)
    const res = await apiFetch(`/api/admin/settings/assignees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: editName.trim(), type_label: editLabel.trim() || null }),
    })
    if (res.ok) { setEditId(null); load() }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this assignee?')) return
    await apiFetch(`/api/admin/settings/assignees/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <CrudSection
      title="Assignees"
      description="Team members who can be assigned to risk items."
      items={items}
      loading={loading}
      onAdd={() => setAdding(true)}
      addForm={
        adding && (
          <div style={s.addForm}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />
            <input
              className="input"
              style={{ width: 160 }}
              placeholder="Role / label (optional)"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleAdd} disabled={saving || !newName.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setAdding(false); setNewName(''); setNewLabel('') }}>
              Cancel
            </button>
          </div>
        )
      }
      renderItem={item => (
        <>
          <td style={s.td}>
            {editId === item.id ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} style={{ maxWidth: 200 }} />
                <input className="input" value={editLabel} onChange={e => setEditLabel(e.target.value)} placeholder="Role / label" style={{ maxWidth: 160 }} />
              </div>
            ) : (
              <span style={s.itemName}>{item.name}{item.type_label && <span style={s.typeLabel}>{item.type_label}</span>}</span>
            )}
          </td>
          <td style={{ ...s.td, ...s.tdActions }}>
            {editId === item.id ? (
              <>
                <button className="btn btn-primary" style={s.actionBtn} onClick={() => handleUpdate(item.id)} disabled={saving}>Save</button>
                <button className="btn btn-secondary" style={s.actionBtn} onClick={() => setEditId(null)}>Cancel</button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost" style={s.actionBtn} onClick={() => { setEditId(item.id); setEditName(item.name); setEditLabel(item.type_label || '') }}>Edit</button>
                <button className="btn btn-ghost" style={{ ...s.actionBtn, color: 'var(--risk-high)' }} onClick={() => handleDelete(item.id)}>Delete</button>
              </>
            )}
          </td>
        </>
      )}
    />
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Settings() {
  const apiFetch = useAdminFetch()

  return (
    <AdminLayout>
      <div className="fade-in">
        <div style={s.pageHeader}>
          <h1 style={s.pageTitle}>Settings</h1>
          <p style={s.pageDesc}>Manage operating companies and assignees used across engagements.</p>
        </div>

        <PortalURLSection />
        <OCSection apiFetch={apiFetch} />
        <AssigneeSection apiFetch={apiFetch} />
      </div>
    </AdminLayout>
  )
}

const s = {
  pageHeader: { marginBottom: 28 },
  pageTitle: { fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)' },
  pageDesc: { fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 4 },

  section: { marginBottom: 36 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  sectionTitle: { fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' },
  sectionDesc: { fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 3 },

  addForm: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    padding: '12px 16px',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 12,
  },

  table: { width: '100%', borderCollapse: 'collapse' },
  td: {
    padding: '10px 16px',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'middle',
  },
  tdActions: { textAlign: 'right', width: 160 },
  actionBtn: { height: 28, padding: '0 10px', fontSize: 'var(--text-xs)' },
  itemName: { display: 'flex', alignItems: 'center', gap: 8 },
  typeLabel: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '1px 6px',
  },
  emptyState: {
    padding: '32px',
    textAlign: 'center',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
  },
}
