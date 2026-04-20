import React, { useState } from 'react'
import { BASE_PATH } from '../../config'

export default function EvaluationLogin({ token, onSuccess }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch(`${BASE_PATH}/api/evaluation/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), token }),
      })

      if (!res.ok) {
        setError('Email address not recognised for this engagement. Please check and try again.')
        return
      }

      const data = await res.json()
      onSuccess({
        accessToken: data.access_token,
        email: email.trim().toLowerCase(),
        engagementToken: token,
      })
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.container} className="fade-in">
        <div style={styles.header}>
          <div style={styles.wordmark}>ISDD Portal</div>
          <div style={styles.subtitle}>Information Security Due Diligence</div>
        </div>

        <div className="card" style={styles.card}>
          <div style={styles.cardHeader}>
            <h1 style={styles.title}>IT Representative Portal</h1>
            <p style={styles.description}>
              Enter the email address associated with this engagement to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="ir-email">
                Email address
              </label>
              <input
                id="ir-email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoFocus
                required
                disabled={loading}
              />
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', height: 38, justifyContent: 'center' }}
              disabled={loading || !email.trim()}
            >
              {loading ? 'Verifying…' : 'Continue'}
            </button>
          </form>
        </div>

        <p style={styles.footer}>
          Albatha IT — Information Security Team
        </p>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-primary)',
    padding: '24px 16px',
  },
  container: {
    width: '100%',
    maxWidth: 420,
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  header: {
    textAlign: 'center',
  },
  wordmark: {
    fontSize: 'var(--text-xl)',
    fontWeight: 600,
    color: 'var(--accent)',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
    marginTop: 4,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '24px 28px 0',
  },
  title: {
    fontSize: 'var(--text-lg)',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  description: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-secondary)',
    marginTop: 6,
    lineHeight: 1.6,
  },
  form: {
    padding: '20px 28px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
  error: {
    fontSize: 'var(--text-sm)',
    color: 'var(--risk-high)',
    background: 'var(--risk-high-bg)',
    border: '1px solid currentColor',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    lineHeight: 1.5,
  },
  footer: {
    textAlign: 'center',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
  },
}
