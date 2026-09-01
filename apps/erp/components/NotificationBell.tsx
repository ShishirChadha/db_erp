'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { apiFetch } from '@/lib/api-client';

interface Notification {
  id: string;
  type: 'task_assigned' | 'task_reassigned' | 'task_watched' | 'comment_added' | 'mention' | 'status_changed' | 'due_soon' | 'overdue' | 'backup_ready' | 'digest';
  actor_name: string | null;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

function composeMessage(n: Notification): string {
  const actor = n.actor_name || 'Someone';
  switch (n.type) {
    case 'task_assigned':
    case 'task_reassigned':
      return `${actor} assigned you to "${n.title}"`;
    case 'task_watched':
      return `${actor} added you as a watcher on "${n.title}"`;
    case 'comment_added':
      return `${actor} commented on "${n.title}"${n.body ? `: ${n.body}` : ''}`;
    case 'mention':
      return `${actor} mentioned you in "${n.title}"${n.body ? `: ${n.body}` : ''}`;
    case 'status_changed':
      return `${actor} changed "${n.title}"${n.body ? ` (${n.body})` : ''}`;
    case 'due_soon':
      return `"${n.title}" is due soon${n.body ? ` (${n.body})` : ''}`;
    case 'overdue':
      return `"${n.title}" is overdue${n.body ? ` (${n.body})` : ''}`;
    case 'backup_ready':
      return n.body || n.title;
    case 'digest':
      return n.body || n.title;
    default:
      return n.title;
  }
}

export default function NotificationBell() {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    const res = await apiFetch('/api/notifications/unread-count');
    if (res.ok) setUnreadCount((await res.json()).count || 0);
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchUnreadCount();
    }, 30000);
    const handleVisible = () => {
      if (document.visibilityState === 'visible') fetchUnreadCount();
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [fetchUnreadCount]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openPanel = async () => {
    setOpen(prev => !prev);
    if (!open) {
      setLoading(true);
      const res = await apiFetch('/api/notifications?limit=20');
      if (res.ok) setNotifications(await res.json());
      setLoading(false);
    }
  };

  const handleClick = async (n: Notification) => {
    if (!n.read_at) {
      await apiFetch(`/api/notifications/${n.id}`, { method: 'PATCH' });
      setUnreadCount(c => Math.max(0, c - 1));
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  const handleMarkAllRead = async () => {
    await apiFetch('/api/notifications/mark-all-read', { method: 'POST' });
    setUnreadCount(0);
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
  };

  return (
    <div className="relative" ref={containerRef}>
      <button onClick={openPanel} className="relative p-2 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground text-xs leading-none font-medium rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto bg-card border border-border rounded-xl shadow-lg z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-xs text-primary hover:underline">Mark all read</button>
            )}
          </div>
          {loading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
          {!loading && notifications.length === 0 && <p className="p-4 text-sm text-muted-foreground">No notifications yet.</p>}
          {!loading && notifications.map(n => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`block w-full text-left px-3 py-2.5 text-sm border-b border-border hover:bg-muted ${!n.read_at ? 'bg-info/15' : ''}`}
            >
              <p className="text-foreground line-clamp-3">{composeMessage(n)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
