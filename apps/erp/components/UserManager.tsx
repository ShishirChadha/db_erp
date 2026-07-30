'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Checkbox } from '@/components/ui/checkbox'

interface AppUser {
  id: string
  email: string
  full_name: string | null
  role: 'owner' | 'manager' | 'employee'
  is_active: boolean
  allowed_pages: string[]
  page_edit_keys: string[]
  username: string | null
  contact_email: string | null
  employee_id: string | null
}

const ROLE_LABELS: Record<AppUser['role'], string> = { owner: 'Owner', manager: 'Manager', employee: 'Employee' }

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

// Dashboard/Pending Tasks are nav landing pages, not mutable resources -- they have no
// "Can edit" concept and profile_page_actions.page_key's DB constraint rejects them.
// Must match EDITABLE_PAGE_KEYS in app/api/users/route.ts and app/api/users/[id]/route.ts.
const EDITABLE_PAGE_KEYS = ['new_entry', 'accessories', 'repair_jobs', 'sku_master', 'live_stock', 'invoices', 'customers', 'activities']

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let pw = ''
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)]
  return pw
}

function PageAccessCheckboxes({
  selected, onChange, editKeys, onEditChange,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  editKeys: string[]
  onEditChange: (next: string[]) => void
}) {
  const toggle = (key: string) => {
    const next = selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]
    onChange(next)
    // Dropping view access for a page drops its edit grant too -- edit implies view.
    if (!next.includes(key) && editKeys.includes(key)) onEditChange(editKeys.filter(k => k !== key))
  }
  const toggleEdit = (key: string) => {
    onEditChange(editKeys.includes(key) ? editKeys.filter(k => k !== key) : [...editKeys, key])
  }
  return (
    <div className="grid grid-cols-2 gap-1 mt-2">
      {PAGE_OPTIONS.map(opt => (
        <div key={opt.key} className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={selected.includes(opt.key)} onCheckedChange={() => toggle(opt.key)} />
            {opt.label}
          </label>
          {selected.includes(opt.key) && EDITABLE_PAGE_KEYS.includes(opt.key) && (
            <label className="flex items-center gap-1 text-xs text-gray-500">
              <Checkbox checked={editKeys.includes(opt.key)} onCheckedChange={() => toggleEdit(opt.key)} />
              Can edit
            </label>
          )}
        </div>
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
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AppUser['role']>('employee')
  const [allowedPages, setAllowedPages] = useState<string[]>([])
  const [editKeysNew, setEditKeysNew] = useState<string[]>([])

  // Which existing user row has its access editor / profile editor open
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPages, setEditPages] = useState<string[]>([])
  const [editKeys, setEditKeys] = useState<string[]>([])
  const [newPasswordById, setNewPasswordById] = useState<Record<string, string>>({})
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editProfile, setEditProfile] = useState({ fullName: '', employeeId: '', contactEmail: '' })

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
    if (!username.trim()) { setError('User ID is required.'); return }
    if (/[@\s]/.test(username.trim())) { setError('User ID cannot contain spaces or "@" — use a plain name like ShishirCH.'); return }
    if (!password || password.length < 6) { setError('Password must be at least 6 characters.'); return }
    busyRef.current = true
    setBusy(true)
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim(),
          password,
          full_name: fullName.trim() || undefined,
          contact_email: contactEmail.trim() || undefined,
          employee_id: employeeId.trim() || undefined,
          role,
          allowed_pages: allowedPages,
          page_edit_keys: editKeysNew,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create user.')
      setUsername(''); setFullName(''); setContactEmail(''); setEmployeeId(''); setPassword(''); setRole('employee'); setAllowedPages([]); setEditKeysNew([])
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
    setEditKeys(u.page_edit_keys)
  }

  const saveAccess = async (id: string) => {
    if (busyRef.current) return
    setError('')
    busyRef.current = true
    setBusy(true)
    try {
      const res = await apiFetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ allowed_pages: editPages, page_edit_keys: editKeys }) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Failed to save access. Changes were not saved.')
        return
      }
      setEditingId(null)
      await fetchUsers()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const openEditProfile = (u: AppUser) => {
    setEditingProfileId(u.id)
    setEditProfile({ fullName: u.full_name || '', employeeId: u.employee_id || '', contactEmail: u.contact_email || '' })
  }

  const saveProfile = async (id: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await apiFetch(`/api/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: editProfile.fullName.trim(),
          employee_id: editProfile.employeeId.trim(),
          contact_email: editProfile.contactEmail.trim(),
        }),
      })
      setEditingProfileId(null)
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
            <label className="block text-xs font-medium text-gray-600 mb-1">User ID</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="border p-2 w-full rounded" placeholder="e.g. ShishirCH, Rohit" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Display Name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="border p-2 w-full rounded" placeholder="e.g. Rohit Sharma" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Employee ID (optional)</label>
            <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Contact Email (optional, for notifications)</label>
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="border p-2 w-full rounded" placeholder="employee@digitalbluez.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
            <div className="flex gap-2">
              <input value={password} onChange={(e) => setPassword(e.target.value)} className="border p-2 w-full rounded" />
              <button type="button" onClick={() => setPassword(generatePassword())} className="text-xs px-2 py-1 rounded bg-gray-100 whitespace-nowrap">
                Generate
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as AppUser['role'])} className="border p-2 w-full rounded">
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </div>
        </div>

        {role !== 'owner' && (
          <div className="mb-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Page Access</label>
            <PageAccessCheckboxes selected={allowedPages} onChange={setAllowedPages} editKeys={editKeysNew} onEditChange={setEditKeysNew} />
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
                  <div className="text-sm font-medium">{u.full_name || u.username || u.email}</div>
                  <div className="text-xs text-gray-500">
                    {u.username ? `ID: ${u.username}` : u.email} · {ROLE_LABELS[u.role]}
                    {u.employee_id && <> · Emp #{u.employee_id}</>}
                    {!u.is_active && <span className="text-red-500"> · Inactive</span>}
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  <button onClick={() => openEditProfile(u)} disabled={busy} className="text-xs px-2 py-1 rounded bg-gray-100">
                    Edit name / ID
                  </button>
                  {u.role !== 'owner' && (
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

              {editingProfileId === u.id && (
                <div className="mt-2 border-t pt-2 grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Display Name</label>
                    <input
                      value={editProfile.fullName}
                      onChange={(e) => setEditProfile(prev => ({ ...prev, fullName: e.target.value }))}
                      className="border p-1 text-sm rounded w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Employee ID</label>
                    <input
                      value={editProfile.employeeId}
                      onChange={(e) => setEditProfile(prev => ({ ...prev, employeeId: e.target.value }))}
                      className="border p-1 text-sm rounded w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Contact Email</label>
                    <input
                      value={editProfile.contactEmail}
                      onChange={(e) => setEditProfile(prev => ({ ...prev, contactEmail: e.target.value }))}
                      className="border p-1 text-sm rounded w-full"
                    />
                  </div>
                  <div className="col-span-3 flex gap-2 mt-1">
                    <button onClick={() => saveProfile(u.id)} disabled={busy} className="bg-blue-600 text-white text-xs px-3 py-1 rounded disabled:opacity-50">
                      Save
                    </button>
                    <button onClick={() => setEditingProfileId(null)} className="text-xs px-3 py-1 rounded bg-gray-100">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {editingId === u.id && (
                <div className="mt-2 border-t pt-2">
                  <PageAccessCheckboxes selected={editPages} onChange={setEditPages} editKeys={editKeys} onEditChange={setEditKeys} />
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
