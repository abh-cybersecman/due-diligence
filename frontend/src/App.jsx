import React from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import EvaluationPortal from './pages/evaluation/EvaluationPortal'
import VendorLogin from './pages/vendor/VendorLogin'
import AdminLogin from './pages/admin/Login'
import Dashboard from './pages/admin/Dashboard'
import NewEngagement from './pages/admin/NewEngagement'
import EngagementDetail from './pages/admin/EngagementDetail'
import Settings from './pages/admin/Settings'
import { BASE_PATH } from './config'

function ProtectedAdmin({ children }) {
  const { adminSession } = useAuth()
  if (!adminSession) return <Navigate to="/admin/login" replace />
  return children
}

function NotFound() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Page not found</span>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={BASE_PATH}>
        <Routes>
          <Route path="/" element={<Navigate to="/admin/login" replace />} />

          {/* Admin */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/dashboard" element={<ProtectedAdmin><Dashboard /></ProtectedAdmin>} />
          <Route path="/admin/engagements/new" element={<ProtectedAdmin><NewEngagement /></ProtectedAdmin>} />
          <Route path="/admin/engagements/:id" element={<ProtectedAdmin><EngagementDetail /></ProtectedAdmin>} />
          <Route path="/admin/settings" element={<ProtectedAdmin><Settings /></ProtectedAdmin>} />

          {/* Portals */}
          <Route path="/evaluation/:token" element={<EvaluationPortal />} />
          <Route path="/respond/:token" element={<VendorLogin />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
