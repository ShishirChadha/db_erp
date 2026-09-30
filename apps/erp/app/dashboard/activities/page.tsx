'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ActivityList from '@/components/ActivityList';
import CalendarFeedLink from '@/components/CalendarFeedLink';

// ActivityCalendar pulls in 4 @fullcalendar/* packages -- real weight (this
// route was one of the heaviest first-loads in the app) for a view that isn't
// the default tab ('list' is). Code-split so that JS is only fetched when
// someone actually clicks over to Calendar.
const ActivityCalendar = dynamic(() => import('@/components/ActivityCalendar'), { ssr: false });
import { toast } from 'sonner';
import { getPendingReminders, markReminderSent } from '@/app/actions/reminders';
import { CalendarDays } from 'lucide-react';
import RequirePageAccess from '@/components/RequirePageAccess';

function ActivitiesPage() {
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const router = useRouter();

  // Poll for reminders every minute
  useEffect(() => {
    const checkReminders = async () => {
      const reminders = await getPendingReminders();
      for (const r of reminders) {
        toast(`Reminder: ${r.title}`, {
          description: r.description,
          duration: 10000,
          action: { label: 'Dismiss', onClick: () => markReminderSent(r.id) },
        });
        await markReminderSent(r.id);
      }
    };
    checkReminders();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') checkReminders();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // List and Calendar are separate Tabs.Content panels -- Radix unmounts
  // whichever one isn't active, so switching tabs already remounts it and
  // fetches fresh data with no extra signal needed. There used to be a
  // `key={refreshKey}`-driven forced remount here to keep the two tabs in
  // sync, but keying a component on its own "something changed" callback
  // means every in-place edit (e.g. a table cell save inside an open task
  // detail modal) tears down and rebuilds the whole tree, closing whatever
  // modal was open. ActivityList/ActivityCalendar already refetch their own
  // data after any change they make; no-op is enough here.
  const refresh = () => {};

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Activity Hub</h1>
        <CalendarFeedLink />
      </div>
      <Tabs defaultValue="list" onValueChange={(v) => setView(v as 'list' | 'calendar')}>
        <TabsList>
          <TabsTrigger value="list">List View</TabsTrigger>
          <TabsTrigger value="calendar">Calendar View</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <ActivityList onUpdate={refresh} />
        </TabsContent>
        <TabsContent value="calendar">
          <ActivityCalendar onUpdate={refresh} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ActivitiesPageGuarded() {
  return (
    <RequirePageAccess pageKey="activities">
      <ActivitiesPage />
    </RequirePageAccess>
  );
}