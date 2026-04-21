import React, { useEffect, useRef, useState } from 'react'

export default function MultiSelectDropdown({ items, value, onChange, placeholder = 'Select…', disabled = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function outside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  function toggle(id) {
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id])
  }

  const selected = items.filter(i => value.includes(i.id))

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: '5px 8px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: disabled ? 'var(--bg-subtle)' : 'var(--bg-surface)',
          minHeight: 34,
          alignItems: 'center',
          cursor: disabled ? 'default' : 'pointer',
          userSelect: 'none',
        }}
        onClick={() => !disabled && setOpen(o => !o)}
      >
        {selected.length === 0 ? (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{placeholder}</span>
        ) : (
          selected.map(i => (
            <span
              key={i.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: 'var(--accent-subtle)',
                color: 'var(--accent)',
                borderRadius: 100,
                padding: '1px 8px',
                fontSize: 'var(--text-xs)',
                fontWeight: 500,
              }}
            >
              {i.name}
              {!disabled && (
                <span
                  style={{ cursor: 'pointer', lineHeight: 1, fontSize: 13, opacity: 0.7 }}
                  onClick={e => { e.stopPropagation(); toggle(i.id) }}
                >
                  ×
                </span>
              )}
            </span>
          ))
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10, paddingLeft: 4, flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </div>
      {open && !disabled && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 2px)',
          left: 0,
          right: 0,
          minWidth: 200,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-md)',
          zIndex: 50,
          maxHeight: 240,
          overflowY: 'auto',
        }}>
          {items.length === 0 ? (
            <div style={{ padding: '12px', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              No options available.
            </div>
          ) : (
            items.map(i => (
              <div
                key={i.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  fontSize: 'var(--text-sm)',
                  cursor: 'pointer',
                  background: value.includes(i.id) ? 'var(--accent-subtle)' : 'transparent',
                  transition: 'background-color 120ms ease',
                }}
                onClick={() => toggle(i.id)}
              >
                <span style={{
                  width: 14,
                  height: 14,
                  border: `2px solid ${value.includes(i.id) ? 'var(--accent)' : 'var(--border-strong)'}`,
                  borderRadius: 3,
                  background: value.includes(i.id) ? 'var(--accent)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background-color 120ms ease, border-color 120ms ease',
                }}>
                  {value.includes(i.id) && (
                    <span style={{ color: 'white', fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>
                  )}
                </span>
                {i.name}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
