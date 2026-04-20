import React from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import EvaluationPortal from './pages/evaluation/EvaluationPortal'
import VendorLogin from './pages/vendor/VendorLogin'
import { BASE_PATH } from './config'

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
          <Route path="/evaluation/:token" element={<EvaluationPortal />} />
          <Route path="/respond/:token" element={<VendorLogin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
