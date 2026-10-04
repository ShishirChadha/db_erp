import { supabaseAdmin } from './supabase/service'
import { resolveEntityKey } from './invoice-finalize'

/**
 * Period locking, enforced in the API layer -- which is this project's actual
 * security boundary for writes, since RLS is not the enforcement mechanism for
 * most tables.
 *
 * The lock is on the TRANSACTION date, never the entry date. That is the whole
 * point: entry-date locking still lets someone insert a row dated inside a
 * period that has already been filed, which is precisely the drift a lock is
 * supposed to prevent.
 *
 * Drafts are deliberately not the caller's concern here -- a draft does not
 * appear in a return, so callers should only consult this for rows that post.
 */
export type LockModule = 'sales' | 'purchases' | 'banking' | 'accounts'

export interface LockCheck {
  locked: boolean
  message?: string
}

export async function checkPeriodLock(
  module: LockModule,
  txnDate: string | null | undefined,
  paymentAccountOrEntityKey?: string | null
): Promise<LockCheck> {
  if (!txnDate) return { locked: false }

  // Accepts either a payment_account ('Digitalbluez') or an entity key
  // ('digitalbluez'), since callers hold one or the other.
  const entityKey = resolveEntityKey(paymentAccountOrEntityKey ?? null)

  const { data, error } = await supabaseAdmin.rpc('is_period_locked', {
    p_entity_key: entityKey,
    p_module: module,
    p_txn_date: txnDate,
  })

  // Fail open on an infrastructure error rather than blocking all writes: a
  // lock is a bookkeeping guard, not a security control, and the API role
  // checks are what actually protect this data.
  if (error) {
    console.error('[period-lock] check failed, allowing write:', error.message)
    return { locked: false }
  }

  if (data === true) {
    return {
      locked: true,
      message:
        `This ${module} period is locked up to and including a date on or after ${txnDate}. ` +
        `A locked period has usually been filed. Ask the owner to unlock a window for it, ` +
        `or record the correction in an open period instead.`,
    }
  }
  return { locked: false }
}

/** 409 body shape, so every caller reports a lock identically. */
export function periodLockedResponse(check: LockCheck) {
  return { error: check.message, error_code: 'period_locked' as const }
}
