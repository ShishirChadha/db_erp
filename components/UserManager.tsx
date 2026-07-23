'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '@/lib/api-client'

interface AppUser {
  id: string
  email: string
  full_name: string | null
  role: 'owner' | 'employee'
  is_active: boolean
  allowed_pages: string[]
}

const PAGE_OPTIONS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'pending_tasks', label: 'Pending Tasks' },
  { key: 'new_entry', label: 'New Entry' },
  { key: 'accessories', label: 'Accessories' },
  { key: 'repair_jobs', label: 'Repair Jobs' },
  { key: 'sku_master', label: 'SKU Master' },
  { key: 'live_stock', label: 'Live Stock' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'customers', label: 'Customers' },
  { key: 'activities', label: 'Activity Hub' },
]

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let pw = ''
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)]
  return pw
}

function PageAccessCheckboxes({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key])
  }
  return (
    <div className="grid grid-cols-2 gap-1 mt-2">
      {PAGE_OPTIONS.map(opt => (
        <label key={opt.key} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.includes(opt.key)} onChange={() => toggle(opt.key)} />
          {opt.label}
        </label>
      ))}
    </div>
  )
}

export default function UserManager() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  // Create-user form state
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'owner' | 'employee'>('employee')
  const [allowedPages, setAllowedPages] = useState<string[]>([])

  // Which existing user row has its access editor open
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPages, setEditPages] = useState<string[]>([])
  const [newPasswordById, setNewPasswordById] = useState<Record<string, string>>({})

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/users')
    setUsers(res.ok ? await res.json() : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  // All actions below share a single `busy` lock (matching existing behavior
  // where any in-flight action disables the others) -- guard re-entrancy with
  // a ref so a rapid double click can't fire two requests before the state
  // update renders.
  const createUser = async () => {
    if (busyRef.current) return
    setError('')
    if (!email.trim()) { setError('Email is required.'); return }
    if (!password || password.length < 6) { setError('Password must be at least 6 characters.'); return }
    busyRef.current = true
    setBusy(true)
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          password,
          full_name: fullName.trim() || undefined,
          role,
          allowed_pages: allowedPages,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create user.')
      setEmail(''); setFullName(''); setPassword(''); setRole('employee'); setAllowedPages([])
      await fetchUsers()
    } catch (e: any) {
      setError(e.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const toggleActive = async (u: AppUser) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await apiFetch(`/api/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !u.is_active }) })
      await fetchUsers()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const openEditAccess = (u: AppUser) => {
    setEditingId(u.id)
    setEditPages(u.allowed_pages)
  }

  const saveAccess = async (id: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await apiFetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ allowed_pages: editPages }) })
      setEditingId(null)
      await fetchUsers()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const setNewPassword = async (id: string) => {
    if (busyRef.current) return
    const pw = newPasswordById[id]
    if (!pw || pw.length < 6) { setError('New password must be at least 6 characters.'); return }
    busyRef.current = true
    setBusy(true)
    try {
      await apiFetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ password: pw }) })
      setNewPasswordById(prev => ({ ...prev, [id]: '' }))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Create logins for owner/employee accounts and choose exactly which tabs each employee can see. Owners always have full access.
      </p>

      {error && <div className="text-red-600 text-sm mb-3">{error}</div>}

      <div className="border rounded p-4 mb-6">
        <h3 className="font-medium text-sm mb-3">Create User</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="border p-2 w-full rounded" placeholder="employee@digitalbluez.com" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Full Name (optional)</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Password</label>
            <div className="flex gap-2">
              <input value={password} onChange={(e) => setPassword(e.target.value)} className="border p-2 w-full rounded" />
              <button type="button" onClick={() => setPassword(generatePassword())} className="text-xs px-2 py-1 rounded bg-gray-100 whitespace-nowrap">
                Generate
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'employee')} className="border p-2 w-full rounded">
              <option value="employee">Employee</option>
              <option value="owner">Owner</option>
            </select>
          </div>
        </div>

        {role === 'employee' && (
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Page Access</label>
            <PageAccessCheckboxes selected={allowedPages} onChange={setAllowedPages} />
          </div>
        )}

        <button onClick={createUser} disabled={busy} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
          {busy ? 'Creating...' : 'Create User'}
        </button>
      </div>

      <h3 className="font-medium text-sm mb-3">Existing Users</h3>
      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="border rounded divide-y">
          {users.length === 0 && <p className="text-sm text-gray-400 p-2">No users found.</p>}
          {users.map(u => (
            <div key={u.id} className="p-2">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm font-medium">{u.email}</div>
                  <div className="text-xs text-gray-500">
                    {u.full_name || '—'} · {u.role === 'owner' ? 'Owner' : 'Employee'}
                    {!u.is_active && <span className="text-red-500"> · Inactive</span>}
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  {u.role === 'employee' && (
                    <button onClick={() => openEditAccess(u)} disabled={busy} className="text-xs px-2 py-1 rounded bg-gray-100">
                      Edit access
                    </button>
                  )}
                  <button
                    onClick={() => toggleActive(u)}
                    disabled={busy}
                    className={`text-xs px-2 py-1 rounded ${u.is_active ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}
                  >
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>

              {editingId === u.id && (
                <div className="mt-2 border-t pt-2">
                  <PageAccessCheckboxes selected={editPages} onChange={setEditPages} />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => saveAccess(u.id)} disabled={busy} className="bg-blue-600 text-white text-xs px-3 py-1 rounded disabled:opacity-50">
                      Save Access
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1 rounded bg-gray-100">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-2 flex gap-2 items-center">
                <input
                  type="text"
                  value={newPasswordById[u.id] || ''}
                  onChange={(e) => setNewPasswordById(prev => ({ ...prev, [u.id]: e.target.value }))}
                  placeholder="Set new password..."
                  className="border p-1 text-sm rounded flex-1 max-w-xs"
                />
                <button onClick={() => setNewPassword(u.id)} disabled={busy} className="text-xs px-2 py-1 rounded bg-gray-100">
                  Set Password
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
