import React, { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

function readSession(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [irSession, setIrSession] = useState(() => readSession('ir_session'))
  const [vendorSession, setVendorSession] = useState(() => readSession('vendor_session'))
  const [adminSession, setAdminSession] = useState(() => {
    try {
      const raw = localStorage.getItem('admin_session')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  function loginIR(data) {
    sessionStorage.setItem('ir_session', JSON.stringify(data))
    setIrSession(data)
  }

  function logoutIR() {
    sessionStorage.removeItem('ir_session')
    setIrSession(null)
  }

  function loginVendor(data) {
    sessionStorage.setItem('vendor_session', JSON.stringify(data))
    setVendorSession(data)
  }

  function logoutVendor() {
    sessionStorage.removeItem('vendor_session')
    setVendorSession(null)
  }

  function loginAdmin(data) {
    localStorage.setItem('admin_session', JSON.stringify(data))
    setAdminSession(data)
  }

  function logoutAdmin() {
    localStorage.removeItem('admin_session')
    setAdminSession(null)
  }

  return (
    <AuthContext.Provider
      value={{
        irSession, loginIR, logoutIR,
        vendorSession, loginVendor, logoutVendor,
        adminSession, loginAdmin, logoutAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
