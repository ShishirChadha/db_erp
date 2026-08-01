import { supabaseAdmin } from './supabase/service'

// Row-per-action audit trail across every module -- distinct from the unrelated
// `activities` table / "Activity Hub" task-collaboration system. Complements
// field_corrections (which stays a pure field-diff ledger): update-type audit_log
// rows reference field_corrections rows via fieldCorrectionIds rather than
// duplicating old/new-value storage. See docs/decisions.md for the ADR.

export type AuditActionType =
  | 'create'
  | 'update'
  | 'status_change'
  | 'soft_delete'
  | 'restore'
  | 'hard_delete'
  | 'void'
  | 'login'
  | 'login_failed'
  | 'logout'

export type AuditSeverity = 'major' | 'minor'

export const SEVERITY_BY_ACTION: Record<AuditActionType, AuditSeverity> = {
  create: 'minor',
  update: 'minor',
  status_change: 'minor',
  login: 'minor',
  login_failed: 'minor',
  logout: 'minor',
  soft_delete: 'major',
  restore: 'major',
  hard_delete: 'major',
  void: 'major',
}

export interface AuditLogInput {
  actor: { id: string | null; email?: string | null; role?: string | null }
  actionType: AuditActionType
  module: string
  tableName?: string | null
  recordId?: string | null
  recordLabel?: string | null
  fieldCorrectionIds?: string[]
  snapshot?: Record<string, any> | null
  restoreStatus?: 'not_applicable' | 'restorable'
  reason?: string | null
  metadata?: Record<string, any> | null
}

// Never throws -- an audit-log write failure must not block the primary
// operation it's describing, same posture as logFieldCorrections and
// lib/notifications.ts's best-effort email step.
export async function logAuditEvent(input: AuditLogInput): Promise<void> {
  try {
    await supabaseAdmin.from('audit_log').insert({
      actor_id: input.actor.id,
      actor_email: input.actor.email ?? null,
      actor_role: input.actor.role ?? null,
      action_type: input.actionType,
      severity: SEVERITY_BY_ACTION[input.actionType],
      module: input.module,
      table_name: input.tableName ?? null,
      record_id: input.recordId ?? null,
      record_label: input.recordLabel ?? null,
      field_correction_ids: input.fieldCorrectionIds && input.fieldCorrectionIds.length > 0 ? input.fieldCorrectionIds : null,
      snapshot: input.snapshot ?? null,
      restore_status: input.restoreStatus ?? 'not_applicable',
      reason: input.reason ?? null,
      metadata: input.metadata ?? null,
    })
  } catch (err) {
    console.error('logAuditEvent failed', err)
  }
}
