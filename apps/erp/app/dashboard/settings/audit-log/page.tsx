'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import { Pagination } from '@/components/Pagination'
import { EmptyTableRow } from '@/components/EmptyTableRow'
import { ErrorBanner } from '@/components/ErrorBanner'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, RotateCcw, Undo2 } from 'lucide-react'
import { useAsyncAction } from '@/lib/useAsyncAction'

interface FieldCorrectionDetail {
  id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  reason: string | null
  changed_at: string
}

interface AuditLogRow {
  id: string
  actor_id: string | null
  actor_email: string | null
  actor_role: string | null
  action_type: string
  severity: 'major' | 'minor'
  module: string
  table_name: string | null
  record_id: string | null
  record_label: string | null
  field_correction_ids: string[] | null
  field_corrections: FieldCorrectionDetail[]
  snapshot: any
  restore_status: 'not_applicable' | 'restorable' | 'restored' | 'restore_failed'
  restored_at: string | null
  restored_by: string | null
  reason: string | null
  metadata: any
  created_at: string
}

const PAGE_SIZE = 25

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  status_change: 'Status changed',
  soft_delete: 'Deleted',
  restore: 'Restored',
  hard_delete: 'Permanently deleted',
  void: 'Voided',
  login: 'Signed in',
  login_failed: 'Sign-in failed',
  logout: 'Signed out',
}

const MODULE_OPTIONS = [
  'sales', 'stock', 'purchase_orders', 'sku_master', 'repair_jobs', 'replacement_jobs',
  'rma', 'customers', 'vendors', 'invoices', 'activities', 'settings', 'auth',
]
const ACTION_OPTIONS = Object.keys(ACTION_LABELS)

export default function AuditLogPage() {
  const { isOwner, loading: roleLoading } = useRole()
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const [module, setModule] = useState('')
  const [actionType, setActionType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (module) params.set('module', module)
    if (actionType) params.set('action_type', actionType)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)

    const res = await apiFetch(`/api/audit-log?${params.toString()}`)
    if (!res.ok) {
      setError('Failed to load audit log.')
      setLoading(false)
      return
    }
    const json = await res.json()
    setRows(json.data || [])
    setTotal(json.total || 0)
    setLoading(false)
  }, [page, module, actionType, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  if (roleLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Audit Log</h1>
        <p className="text-sm text-gray-500">
          {isOwner ? "Every user's activity, most recent first." : 'Your own activity, most recent first.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Module</label>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={module}
            onChange={(e) => { setPage(1); setModule(e.target.value) }}
          >
            <option value="">All</option>
            {MODULE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Action</label>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={actionType}
            onChange={(e) => { setPage(1); setActionType(e.target.value) }}
          >
            <option value="">All</option>
            {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">From</label>
          <Input type="date" className="h-8" value={dateFrom} onChange={(e) => { setPage(1); setDateFrom(e.target.value) }} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">To</label>
          <Input type="date" className="h-8" value={dateTo} onChange={(e) => { setPage(1); setDateTo(e.target.value) }} />
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="p-2 text-left">When</th>
              {isOwner && <th className="p-2 text-left">User</th>}
              <th className="p-2 text-left">Module</th>
              <th className="p-2 text-left">Action</th>
              <th className="p-2 text-left">Record</th>
              <th className="p-2 text-left"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isOwner ? 6 : 5} className="p-4 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <EmptyTableRow colSpan={isOwner ? 6 : 5} message="No activity found." />
            ) : (
              rows.map((row) => (
                <AuditLogRowView
                  key={row.id}
                  row={row}
                  isOwner={isOwner}
                  expanded={expanded === row.id}
                  onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                  onChanged={load}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
    </div>
  )
}

function AuditLogRowView({
  row, isOwner, expanded, onToggle, onChanged,
}: {
  row: AuditLogRow
  isOwner: boolean
  expanded: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const severityTone = row.severity === 'major' ? 'danger' : 'neutral'

  return (
    <>
      <tr className="border-t hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="p-2 whitespace-nowrap text-gray-500 tabular-nums">
          {new Date(row.created_at).toLocaleString()}
        </td>
        {isOwner && <td className="p-2">{row.actor_email || row.actor_id || '—'}</td>}
        <td className="p-2">{row.module}</td>
        <td className="p-2">
          <StatusBadge tone={severityTone}>{ACTION_LABELS[row.action_type] || row.action_type}</StatusBadge>
        </td>
        <td className="p-2">{row.record_label || row.record_id || '—'}</td>
        <td className="p-2 text-right text-xs text-gray-400">{expanded ? 'Hide' : 'Details'}</td>
      </tr>
      {expanded && (
        <tr className="border-t bg-gray-50/60">
          <td colSpan={isOwner ? 6 : 5} className="p-3">
            <AuditLogDetail row={row} isOwner={isOwner} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  )
}

function AuditLogDetail({ row, isOwner, onChanged }: { row: AuditLogRow; isOwner: boolean; onChanged: () => void }) {
  const { run: runSoftRestore, pending: softPending } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/audit-log/${row.id}/restore-soft-delete`, { method: 'POST' })
    if (res.ok) onChanged()
    else alert((await res.json()).error || 'Restore failed')
  })
  const { run: runHardRestore, pending: hardPending } = useAsyncAction(async () => {
    if (!confirm('Attempt to restore this deleted record from its saved snapshot? This is best-effort and can fail if related data has changed since.')) return
    const res = await apiFetch(`/api/audit-log/${row.id}/restore-hard-delete`, { method: 'POST' })
    if (res.ok) onChanged()
    else alert((await res.json()).error || 'Restore attempt failed')
  })

  return (
    <div className="space-y-3">
      {row.reason && <div className="text-sm"><span className="text-gray-500">Reason: </span>{row.reason}</div>}

      {row.field_corrections?.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-gray-600">Field changes</div>
          {row.field_corrections.map((fc) => (
            <FieldCorrectionLine key={fc.id} fc={fc} isOwner={isOwner} onChanged={onChanged} />
          ))}
        </div>
      )}

      {row.restore_status === 'restored' && (
        <div className="text-xs text-gray-500">
          Restored {row.restored_at ? new Date(row.restored_at).toLocaleString() : ''}
        </div>
      )}

      {row.restore_status === 'restore_failed' && (
        <div className="text-xs text-red-600">Last restore attempt failed.</div>
      )}

      {isOwner && row.action_type === 'soft_delete' && row.restore_status === 'restorable' && (
        <Button size="sm" variant="outline" onClick={runSoftRestore} disabled={softPending}>
          <Undo2 className="h-3.5 w-3.5 mr-1" /> Restore
        </Button>
      )}

      {isOwner && row.action_type === 'hard_delete' && row.restore_status === 'restorable' && (
        <Button size="sm" variant="outline" onClick={runHardRestore} disabled={hardPending}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Attempt Restore
        </Button>
      )}
    </div>
  )
}

function FieldCorrectionLine({ fc, isOwner, onChanged }: { fc: FieldCorrectionDetail; isOwner: boolean; onChanged: () => void }) {
  const { run: revert, pending } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/audit-log/field-corrections/${fc.id}/revert`, { method: 'POST' })
    if (res.ok) onChanged()
    else alert((await res.json()).error || 'Revert failed')
  })

  return (
    <div className="flex items-center justify-between gap-3 text-sm border-b last:border-b-0 py-1">
      <span>
        <span className="font-medium">{fc.field_name}</span>:{' '}
        <span className="text-gray-500 line-through">{fc.old_value ?? '—'}</span>{' '}
        →{' '}
        <span>{fc.new_value ?? '—'}</span>
      </span>
      {isOwner && (
        <Button size="sm" variant="ghost" onClick={revert} disabled={pending} className="h-6 px-2 text-xs">
          Revert
        </Button>
      )}
    </div>
  )
}
