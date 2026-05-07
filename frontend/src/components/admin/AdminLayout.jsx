import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'

function FileTextIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  )
}

function ListIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

function GridIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  )
}

function SettingsIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

const NAV = [
  { to: '/admin/engagements', label: 'Engagements', icon: <ListIcon /> },
  { to: '/admin/dashboard', label: 'Dashboard', icon: <GridIcon /> },
  { to: '/admin/questionnaire', label: 'Questionnaire', icon: <FileTextIcon /> },
  { to: '/admin/settings', label: 'Settings', icon: <SettingsIcon /> },
]

function useTheme() {
  const current = () => document.documentElement.getAttribute('data-theme') || 'light'
  const [theme, setTheme] = useState(current)

  function toggle() {
    const next = current() === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    setTheme(next)
  }

  return { theme, toggle }
}

export default function AdminLayout({ children }) {
  const { adminSession, logoutAdmin } = useAuth()
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()

  async function handleLogout() {
    try {
      await fetch(`${BASE_PATH}/api/admin/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminSession?.accessToken}` },
      })
    } catch {}
    logoutAdmin()
    navigate('/admin/login', { replace: true })
  }

  return (
    <div style={s.shell}>
      {/* Sidebar */}
      <aside style={s.sidebar}>
        <div style={s.sidebarInner}>
          <div style={s.brand}>
            <div style={s.brandName}>ISDD Portal</div>
            <div style={s.brandSub}>IS Team</div>
          </div>

          <nav style={s.nav}>
            <div style={s.navSection}>NAVIGATION</div>
            {NAV.map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                style={({ isActive }) => ({
                  ...s.navItem,
                  ...(isActive ? s.navItemActive : {}),
                })}
              >
                {icon && <span style={s.navIcon}>{icon}</span>}
                {label}
              </NavLink>
            ))}
          </nav>

          <div style={s.sidebarBottom}>
            <button
              className="btn btn-ghost"
              style={s.themeBtn}
              onClick={toggle}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '☀ Light' : '☾ Dark'}
            </button>
            <button className="btn btn-ghost" style={s.logoutBtn} onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={s.main}>
        <div style={s.content}>{children}</div>
      </main>
    </div>
  )
}

const s = {
  shell: {
    display: 'flex',
    minHeight: '100vh',
    background: 'var(--bg-primary)',
  },
  sidebar: {
    width: 220,
    flexShrink: 0,
    background: 'var(--bg-surface)',
    borderRight: '1px solid var(--border)',
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 40,
  },
  sidebarInner: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: '0 0 8px',
  },
  brand: {
    padding: '20px 16px 16px',
    borderBottom: '1px solid var(--border)',
  },
  brandName: {
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    color: 'var(--accent)',
    letterSpacing: '-0.01em',
  },
  brandSub: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    marginTop: 2,
  },
  nav: {
    flex: 1,
    padding: '12px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  navSection: {
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '4px 8px 8px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    textDecoration: 'none',
    borderLeft: '2px solid transparent',
    transition: 'background-color 150ms ease, color 150ms ease',
  },
  navIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 14,
    height: 14,
    color: 'currentColor',
    flexShrink: 0,
  },
  navItemActive: {
    background: 'var(--accent-subtle)',
    color: 'var(--accent)',
    borderLeftColor: 'var(--accent)',
  },
  sidebarBottom: {
    padding: '8px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  themeBtn: {
    width: '100%',
    justifyContent: 'flex-start',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-secondary)',
  },
  logoutBtn: {
    width: '100%',
    justifyContent: 'flex-start',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
  },
  main: {
    flex: 1,
    marginLeft: 220,
    minHeight: '100vh',
    overflow: 'auto',
  },
  content: {
    padding: '28px 32px',
    maxWidth: 1200,
  },
}
