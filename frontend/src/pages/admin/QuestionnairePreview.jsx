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

    // Flatten draft sections → questions into the shape VendorQuestionnaire expects.
    // Vendor form groups by `section` (string) and splits on `is_ai_addendum`.
    const sortedSections = [...draft.sections].sort((a, b) => a.order - b.order)

    const questions = []
    for (const section of sortedSections) {
      const sortedQs = [...(section.questions || [])].sort((a, b) => a.order - b.order)
      for (const q of sortedQs) {
        questions.push({
          id: q.id,
          question_number: q.question_number,
          section: section.title,
          question_text: q.question_text,
          response_type: q.response_type,
          is_ai_addendum: section.is_ai_addendum,
          is_required: q.is_required,
          order: q.order,
        })
      }
    }

    const hasAISection = sortedSections.some((s) => s.is_ai_addendum)

    return {
      id: 'preview',
      application_name: 'Draft preview',
      version_label: draft.version_label,
      status: 'DD_IN_PROGRESS', // visually matches the editable-state render
      is_ai_application: hasAISection,
      questions,
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
