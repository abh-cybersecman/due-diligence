import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'
import VendorQuestionnaire from '../vendor/VendorQuestionnaire'

export default function QuestionnairePreview() {
  const { adminSession } = useAuth()
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`${BASE_PATH}/api/admin/questionnaire/draft`, {
          headers: { Authorization: `Bearer ${adminSession?.accessToken}` },
        })
        if (!res.ok) throw new Error('Failed to load draft questionnaire')
        const data = await res.json()
        if (!cancelled) setDraft(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    }
    load()
    return () => { cancelled = true }
  }, [adminSession])

  const previewMeta = useMemo(() => {
    if (!draft) return null

    const hasAISection = (draft.sections || []).some((s) => s.is_ai_addendum)

    return {
      id: 'preview',
      application_name: 'Draft preview',
      questionnaire_version_id: draft.id,
      version_label: draft.version_label,
      status: 'DD_IN_PROGRESS', // visually matches the editable-state render
      is_ai_application: hasAISection,
      sections: draft.sections || [],
      files: [],
    }
  }, [draft])

  if (error) {
    return (
      <div style={errorPage}>
        <span style={errorText}>{error}</span>
      </div>
    )
  }

  if (!previewMeta) {
    return (
      <div style={errorPage}>
        <span style={loadingText}>Loading preview…</span>
      </div>
    )
  }

  return (
    <VendorQuestionnaire
      previewMode
      previewData={{ meta: previewMeta }}
    />
  )
}

const errorPage = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-primary)',
}
const loadingText = { color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }
const errorText = { color: 'var(--risk-high)', fontSize: 'var(--text-sm)' }
