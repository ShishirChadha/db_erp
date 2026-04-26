'use client';

import { useState, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';

export default function ActivityCalendar({ onUpdate }) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const fetchEvents = async () => {
      const res = await fetch('/api/activities');
      const data = await res.json();
      if (res.ok) {
        const formatted = data.map(act => ({
          id: act.id,
          title: act.title,
          start: act.due_date,
          extendedProps: { status: act.status, tags: act.tags },
        }));
        setEvents(formatted);
      }
    };
    fetchEvents();
  }, []);

  const handleDateSelect = async (info) => {
    const title = prompt('Enter activity title:');
    if (!title) return;
    await fetch('/api/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, due_date: info.startStr, status: 'pending' }),
    });
    onUpdate();
  };

  const handleEventDrop = async (info) => {
    await fetch(`/api/activities/${info.event.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: info.event.startStr }),
    });
    onUpdate();
  };

  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView="dayGridMonth"
      headerToolbar={{
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay'
      }}
      events={events}
      selectable={true}
      select={handleDateSelect}
      eventDrop={handleEventDrop}
      height="auto"
    />
  );
}