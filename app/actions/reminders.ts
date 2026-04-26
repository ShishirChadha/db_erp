'use server';

import { createClient } from '@/lib/supabase/server';

export async function getPendingReminders() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('activities')
    .select('id, title, description')
    .eq('user_id', user.id)
    .lte('reminder_at', now)
    .is('last_reminder_sent', null);
  if (error) return [];
  return data || [];
}

export async function markReminderSent(id: string) {
  const supabase = await createClient();
  await supabase
    .from('activities')
    .update({ last_reminder_sent: new Date().toISOString() })
    .eq('id', id);
}