'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { SimpleModal } from '@/components/SimpleModal';
import { Button } from '@/components/ui/button';

// Subscribable per-user calendar feed -- a "sync my tasks to Google/Outlook/
// phone calendar" alternative to the one-off "Add to Calendar" export on a
// single task's detail view. The feed URL itself is the credential (same idiom
// Google Calendar's own private iCal links use), so this only ever reveals the
// caller's own link and can rotate it, never anyone else's.
export default function CalendarFeedLink() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/activities/calendar-feed/token');
      if (res.ok) setUrl((await res.json()).url);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => { setOpen(true); load(); };

  const { run: regenerate, pending: regenerating } = useAsyncAction(async () => {
    const res = await apiFetch('/api/activities/calendar-feed/token', { method: 'POST' });
    if (res.ok) {
      setUrl((await res.json()).url);
      toast.success('Calendar link regenerated -- the old link no longer works.');
    }
  });

  const copyUrl = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success('Link copied.');
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>Sync to Calendar</Button>
      <SimpleModal isOpen={open} onClose={() => setOpen(false)} title="Sync Your Tasks to a Calendar">
        <div className="space-y-3 text-sm">
          <p className="text-gray-600">
            Subscribe to this link in Google Calendar, Outlook, or your phone&apos;s calendar app to see your Activity Hub tasks
            (with due dates) automatically kept up to date. This link is personal to you -- keep it private.
          </p>
          <div className="flex gap-2">
            <input readOnly value={loading ? 'Loading...' : url || ''} className="flex-1 border rounded p-2 text-xs font-mono" onFocus={e => e.target.select()} />
            <Button variant="outline" size="sm" onClick={copyUrl} disabled={!url}>Copy</Button>
          </div>
          <ul className="text-xs text-gray-500 list-disc pl-4 space-y-1">
            <li><strong>Google Calendar:</strong> Settings → Add calendar → From URL, paste the link above.</li>
            <li><strong>Outlook:</strong> Add calendar → Subscribe from web, paste the link above.</li>
            <li><strong>Apple Calendar:</strong> File → New Calendar Subscription, paste the link above.</li>
          </ul>
          <div className="flex justify-between items-center pt-2">
            <p className="text-xs text-gray-400">Leaked or shared by mistake? Regenerate to invalidate it immediately.</p>
            <Button variant="outline" size="sm" onClick={regenerate} disabled={regenerating || loading}>
              {regenerating ? 'Regenerating...' : 'Regenerate Link'}
            </Button>
          </div>
        </div>
      </SimpleModal>
    </>
  );
}
