'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ActivityList from '@/components/ActivityList';
import ActivityCalendar from '@/components/ActivityCalendar';
import { toast } from 'sonner';
import { getPendingReminders, markReminderSent } from '@/app/actions/reminders';
import { CalendarDays } from 'lucide-react';



export default function ActivitiesPage() {
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [refreshKey, setRefreshKey] = useState(0);
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
    const interval = setInterval(checkReminders, 60000);
    return () => clearInterval(interval);
  }, []);

  const refresh = () => setRefreshKey(prev => prev + 1);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Activity Hub</h1>
        
      </div>
      <Tabs defaultValue="list" onValueChange={(v) => setView(v as 'list' | 'calendar')}>
        <TabsList>
          <TabsTrigger value="list">List View</TabsTrigger>
          <TabsTrigger value="calendar">Calendar View</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <ActivityList key={refreshKey} onUpdate={refresh} />
        </TabsContent>
        <TabsContent value="calendar">
          <ActivityCalendar key={refreshKey} onUpdate={refresh} />
        </TabsContent>
      </Tabs>
    </div>
  );
}