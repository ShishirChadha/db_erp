'use server';

import { supabaseAdmin } from '@/lib/supabase/service';
import { getCookieSessionUser } from '@/lib/auth/session';
import { buildOwnVisibilityFilter } from '@/lib/activities';

// Reminders are a personal nudge -- fire for tasks the current user created
// OR is assigned to, not just tasks they created (owner still only gets
// their own/assigned reminders here too; "see everything" is the list view).
export async function getPendingReminders() {
  const sessionUser = await getCookieSessionUser();
  if (!sessionUser) return [];

  const now = new Date().toISOString();
  const filter = await buildOwnVisibilityFilter(sessionUser.id);

  const { data, error } = await supabaseAdmin
    .from('activities')
    .select('id, title, description')
    .eq('is_deleted', false)
    .or(filter)
    .lte('reminder_at', now)
    .is('last_reminder_sent', null);
  if (error) return [];
  return data || [];
}

export async function markReminderSent(id: string) {
  const sessionUser = await getCookieSessionUser();
  if (!sessionUser) return;
  await supabaseAdmin
    .from('activities')
    .update({ last_reminder_sent: new Date().toISOString() })
    .eq('id', id);
}
