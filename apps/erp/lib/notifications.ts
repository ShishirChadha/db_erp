import { supabaseAdmin } from './supabase/service'
import { sendEmail } from './email'

// 'due_soon'/'overdue'/'backup_ready' are inserted directly by pg_cron-driven Postgres
// functions (scan_activity_due_dates(), generate_backup_snapshot()), not via
// notify()/notifyMany() -- listed here for type-completeness across the app (e.g. NotificationBell).
// 'digest' is inserted directly by app/api/digests/run/route.ts, also bypassing
// notify() -- the digest route sends its own rich HTML email as a separate channel
// (gated by the subscription's own channel toggles), so it doesn't want notify()'s
// generic plain-text emailBestEffort() firing a second, duller email alongside it.
export type NotificationType = 'task_assigned' | 'task_reassigned' | 'task_watched' | 'comment_added' | 'mention' | 'status_changed' | 'due_soon' | 'overdue' | 'backup_ready' | 'digest'

interface NotifyInput {
  recipientId: string
  type: NotificationType
  actorId: string | null
  activityId?: string | null
  commentId?: string | null
  title: string
  body?: string | null
  link?: string | null
}

const TYPE_SUBJECT: Record<NotificationType, string> = {
  task_assigned: 'You were assigned a task',
  task_reassigned: 'You were assigned a task',
  task_watched: 'You were added to watch a task',
  comment_added: 'New comment on your task',
  mention: 'You were mentioned in a task',
  status_changed: 'Task status changed',
  due_soon: 'Task due soon',
  overdue: 'Task overdue',
  backup_ready: 'Backup ready', // never sent via notify() -- see comment on NotificationType above
  digest: 'Report digest', // never sent via notify() -- see comment on NotificationType above
}

// Best-effort email -- never throws, never blocks the caller. The in-app
// notification row (already inserted by the time this runs) is the reliable
// record regardless of whether Resend is configured or the send succeeds.
async function emailBestEffort(recipientId: string, subject: string, title: string, body: string | null) {
  try {
    // Prefer the owner-set contact_email over the auth email -- for username-only
    // logins (profiles.username), the auth email is a synthetic, unreachable address
    // (see lib/auth/username.ts), so contact_email is the only address that can work.
    const { data: profile } = await supabaseAdmin.from('profiles').select('contact_email').eq('id', recipientId).single()
    let to = profile?.contact_email || null
    if (!to) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(recipientId)
      to = data.user?.email || null
    }
    if (!to) return
    const html = `<p>${subject}</p><p><strong>${title}</strong></p>${body ? `<p>${body}</p>` : ''}`
    await sendEmail({ to, subject: `${subject}: ${title}`, html })
  } catch {
    // Config-missing / provider errors are swallowed here by design -- see sendEmail().
  }
}

export async function notify(input: NotifyInput): Promise<void> {
  if (!input.recipientId || input.recipientId === input.actorId) return
  const { error } = await supabaseAdmin.from('notifications').insert({
    recipient_id: input.recipientId,
    type: input.type,
    actor_id: input.actorId,
    activity_id: input.activityId ?? null,
    comment_id: input.commentId ?? null,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  })
  if (error) return
  await emailBestEffort(input.recipientId, TYPE_SUBJECT[input.type], input.title, input.body ?? null)
}

export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  await Promise.all(inputs.map((i) => notify(i)))
}
