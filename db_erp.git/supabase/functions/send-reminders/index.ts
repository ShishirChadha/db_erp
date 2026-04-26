import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async () => {
  const now = new Date().toISOString();
  // Get activities where reminder_at <= now and last_reminder_sent is null or older than 24h
  const { data: activities, error } = await supabase
    .from('activities')
    .select('id, title, description, reminder_at, user_id')
    .lte('reminder_at', now)
    .or('last_reminder_sent.is.null,last_reminder_sent.lt.' + new Date(Date.now() - 24*60*60*1000).toISOString());

  if (error || !activities) {
    return new Response('Error fetching reminders', { status: 500 });
  }

  for (const act of activities) {
    // Get user email
    const { data: user } = await supabase.auth.admin.getUserById(act.user_id);
    const email = user?.user?.email;
    if (!email) continue;

    // Send email using Resend or any SMTP service (free tier: Resend)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'reminders@yourdomain.com',
        to: email,
        subject: `Reminder: ${act.title}`,
        html: `<p><strong>${act.title}</strong></p><p>${act.description || ''}</p><p>Due: ${new Date(act.reminder_at).toLocaleString()}</p>`,
      }),
    });
    if (res.ok) {
      await supabase.from('activities').update({ last_reminder_sent: now }).eq('id', act.id);
    }
  }
  return new Response('OK', { status: 200 });
});