'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { Edit, Trash2, Copy, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { useRole } from '@/lib/auth/useRole';
import { apiFetch } from '@/lib/api-client';
import { createClient } from '@/lib/supabase/client';
import ActivityCommentThread from '@/components/ActivityCommentThread';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleModal } from '@/components/SimpleModal';

// ---------- Type definitions ----------
type Priority = 'low' | 'normal' | 'high' | 'urgent';
type Status = 'pending' | 'in_progress' | 'done' | 'cancelled';
type RelatedType = 'customer' | 'sale' | 'purchase_order' | 'asset' | 'repair_job' | 'invoice' | 'vendor';

interface Activity {
  id: string;
  title: string;
  description?: string | null;
  tags: string[];
  status: Status;
  priority: Priority;
  due_date?: string | null;
  reminder_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by: string;
  created_by_name?: string | null;
  assignee_ids: string[];
  assignee_names: string[];
  watcher_ids: string[];
  watcher_names: string[];
  checklist_total?: number;
  checklist_done?: number;
  related_type?: RelatedType | null;
  related_id?: string | null;
  completed_at?: string | null;
  reviewed_at?: string | null;
}

interface ChecklistItem {
  id: string;
  text: string;
  is_done: boolean;
  position: number;
}

interface AssignableUser {
  id: string;
  full_name: string | null;
  role: 'owner' | 'employee';
}

interface HistoryRow {
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

interface ActivityDetail extends Activity {
  assignees: { user_id: string; name: string | null; assigned_by_name: string | null; assigned_at: string }[];
  watchers: { user_id: string; name: string | null; added_by_name: string | null; added_at: string }[];
  checklist: ChecklistItem[];
  history: HistoryRow[];
  created_by_name: string | null;
  completed_by_name: string | null;
  reviewed_by_name: string | null;
}

const RELATED_TYPE_LABELS: Record<RelatedType, string> = {
  customer: 'Customer', sale: 'Sale', purchase_order: 'Purchase Order',
  asset: 'Asset', repair_job: 'Repair Job', invoice: 'Invoice', vendor: 'Vendor',
};
// Only record types with a real detail route get a clickable deep link; the rest show as plain text.
const RELATED_TYPE_LINK_BASE: Partial<Record<RelatedType, string>> = {
  asset: '/dashboard/stock', purchase_order: '/dashboard/purchase-orders', invoice: '/dashboard/invoices',
};

const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'bg-gray-100 text-gray-600', normal: 'bg-blue-50 text-blue-700',
  high: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700',
};

function userLabel(u: { id: string; full_name: string | null; role?: string }) {
  return u.full_name || `${u.role || 'user'} (${u.id.slice(0, 8)})`;
}

function getTagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 85%)`;
}

// ---------- Simple Modal ----------
// ---------- Shared task form (used by both Add and Edit) ----------
interface TaskFormState {
  title: string;
  description: string;
  tags: string[];
  status: Status;
  priority: Priority;
  due_date: string;
  reminder_at: string;
  related_type: RelatedType | '';
  related_id: string;
  assignee_ids: string[];
  watcher_ids: string[];
  pendingTag: string;
}

// Folds any not-yet-committed tag text into `tags` -- used right before submit
// so typing a tag then clicking Save (without hitting the removed Add button)
// still saves it, instead of silently dropping it.
function commitPendingTag(form: TaskFormState): string[] {
  const pending = form.pendingTag.trim();
  return pending && !form.tags.includes(pending) ? [...form.tags, pending] : form.tags;
}

function TaskForm({
  form, setForm, existingTags, assignableUsers,
}: {
  form: TaskFormState;
  setForm: (updater: (prev: TaskFormState) => TaskFormState) => void;
  existingTags: string[];
  assignableUsers: AssignableUser[];
}) {
  const handleAddTag = () => {
    setForm(prev => {
      const newTag = prev.pendingTag.trim();
      if (!newTag || prev.tags.includes(newTag)) return { ...prev, pendingTag: '' };
      return { ...prev, tags: [...prev.tags, newTag], pendingTag: '' };
    });
  };
  const removeTag = (tag: string) => setForm(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  const toggleAssignee = (userId: string) => {
    setForm(prev => ({
      ...prev,
      assignee_ids: prev.assignee_ids.includes(userId)
        ? prev.assignee_ids.filter(id => id !== userId)
        : [...prev.assignee_ids, userId],
      // An assignee already sees and is notified about the task -- adding them
      // as a watcher too would be a redundant, confusing second relationship.
      watcher_ids: prev.watcher_ids.filter(id => id !== userId),
    }));
  };
  const toggleWatcher = (userId: string) => {
    setForm(prev => ({
      ...prev,
      watcher_ids: prev.watcher_ids.includes(userId)
        ? prev.watcher_ids.filter(id => id !== userId)
        : [...prev.watcher_ids, userId],
    }));
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium">Title *</label>
        <input type="text" className="w-full border rounded p-2" value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} />
      </div>
      <div>
        <label className="block text-sm font-medium">Description</label>
        <textarea rows={3} className="w-full border rounded p-2" value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium">Priority</label>
          <select className="w-full border rounded p-2" value={form.priority} onChange={e => setForm(prev => ({ ...prev, priority: e.target.value as Priority }))}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Status</label>
          <select className="w-full border rounded p-2" value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value as Status }))}>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Assign to</label>
        <div className="border rounded p-2 max-h-32 overflow-y-auto space-y-1">
          {assignableUsers.length === 0 && <p className="text-xs text-gray-400">No other users found.</p>}
          {assignableUsers.map(u => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.assignee_ids.includes(u.id)} onCheckedChange={() => toggleAssignee(u.id)} />
              {userLabel(u)} <span className="text-xs text-gray-400">({u.role})</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">Leave empty for a personal task (only you and the owner will see it).</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Watchers (CC — can see the task, not assigned to do it)</label>
        <div className="border rounded p-2 max-h-32 overflow-y-auto space-y-1">
          {assignableUsers.filter(u => !form.assignee_ids.includes(u.id)).length === 0 && (
            <p className="text-xs text-gray-400">No other users available to watch.</p>
          )}
          {assignableUsers.filter(u => !form.assignee_ids.includes(u.id)).map(u => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.watcher_ids.includes(u.id)} onCheckedChange={() => toggleWatcher(u.id)} />
              {userLabel(u)} <span className="text-xs text-gray-400">({u.role})</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">e.g. a manager who should see this task without owning the work — they get visibility and a notification, but the task stays assigned to whoever&apos;s checked above.</p>
      </div>

      <div>
        <label className="block text-sm font-medium">Tags</label>
        <div className="flex gap-2">
          <input
            list="tag-suggestions" className="border rounded p-2 flex-1" placeholder="Select or type new tag, then press Enter (or just Save)"
            value={form.pendingTag}
            onChange={e => setForm(prev => ({ ...prev, pendingTag: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
            onBlur={handleAddTag}
          />
          <datalist id="tag-suggestions">
            {existingTags.map(tag => <option key={tag} value={tag} />)}
          </datalist>
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {form.tags.map(tag => (
            <span key={tag} style={{ backgroundColor: getTagColor(tag) }} className="px-2 py-1 rounded flex items-center gap-1">
              {tag}
              <button onClick={() => removeTag(tag)} className="text-red-500">×</button>
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium">Due Date</label>
          <input type="datetime-local" className="w-full border rounded p-2" value={form.due_date} onChange={e => setForm(prev => ({ ...prev, due_date: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium">Reminder</label>
          <input type="datetime-local" className="w-full border rounded p-2" value={form.reminder_at} onChange={e => setForm(prev => ({ ...prev, reminder_at: e.target.value }))} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">Link to a record (optional)</label>
        <div className="grid grid-cols-2 gap-2">
          <select className="border rounded p-2" value={form.related_type} onChange={e => setForm(prev => ({ ...prev, related_type: e.target.value as RelatedType | '' }))}>
            <option value="">None</option>
            {(Object.keys(RELATED_TYPE_LABELS) as RelatedType[]).map(t => (
              <option key={t} value={t}>{RELATED_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <input
            type="text" placeholder="Record ID" className="border rounded p-2" value={form.related_id}
            onChange={e => setForm(prev => ({ ...prev, related_id: e.target.value }))}
            disabled={!form.related_type}
          />
        </div>
      </div>
    </div>
  );
}

// Computed fresh (not a static constant) so a form opened later in the day --
// or across a midnight boundary on a long-lived tab -- still gets a sensible
// "today" default rather than a value frozen at first page load.
function buildEmptyForm(): TaskFormState {
  const due = new Date();
  due.setHours(18, 0, 0, 0);
  const reminder = new Date(due);
  reminder.setHours(reminder.getHours() - 2);
  return {
    title: '', description: '', tags: [], status: 'pending', priority: 'normal',
    due_date: format(due, "yyyy-MM-dd'T'HH:mm"),
    reminder_at: format(reminder, "yyyy-MM-dd'T'HH:mm"),
    related_type: '', related_id: '', assignee_ids: [], watcher_ids: [], pendingTag: '',
  };
}

// ---------- Add Activity Modal ----------
function AddActivityModal({
  isOpen, onClose, onUpdate, existingTags, assignableUsers,
}: {
  isOpen: boolean; onClose: () => void; onUpdate: () => void; existingTags: string[]; assignableUsers: AssignableUser[];
}) {
  const [form, setForm] = useState<TaskFormState>(buildEmptyForm);

  // Fresh defaults every time the modal is opened (including reopen-after-cancel),
  // not just after a successful submit -- so the due-date/reminder defaults
  // never go stale relative to "now".
  useEffect(() => {
    if (isOpen) setForm(buildEmptyForm());
  }, [isOpen]);

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async () => {
    if (!form.title.trim()) return alert('Title is required');
    const { pendingTag: _pendingTag, ...formFields } = form;
    const res = await apiFetch('/api/activities', {
      method: 'POST',
      body: JSON.stringify({
        ...formFields,
        tags: commitPendingTag(form),
        due_date: form.due_date || null,
        reminder_at: form.reminder_at || null,
        related_type: form.related_type || null,
        related_id: form.related_type ? form.related_id.trim() || null : null,
      }),
    });
    if (res.ok) {
      onUpdate();
      onClose();
      setForm(buildEmptyForm());
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Failed to add task');
    }
  });

  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="New Task" wide closeOnBackdropClick={false}>
      <TaskForm form={form} setForm={setForm} existingTags={existingTags} assignableUsers={assignableUsers} />
      <div className="flex justify-end gap-2 pt-4">
        <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
        <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {submitting && <Loader2 className="inline size-4 animate-spin mr-1" />}
          Save
        </button>
      </div>
    </SimpleModal>
  );
}

// ---------- Edit Activity Modal ----------
function EditActivityModal({
  activity, isOpen, onClose, onUpdate, existingTags, assignableUsers,
}: {
  activity: Activity | null; isOpen: boolean; onClose: () => void; onUpdate: () => void;
  existingTags: string[]; assignableUsers: AssignableUser[];
}) {
  const [form, setForm] = useState<TaskFormState>(buildEmptyForm);

  useEffect(() => {
    if (activity) {
      setForm({
        title: activity.title || '',
        description: activity.description || '',
        tags: activity.tags || [],
        status: activity.status || 'pending',
        priority: activity.priority || 'normal',
        due_date: activity.due_date ? activity.due_date.slice(0, 16) : '',
        reminder_at: activity.reminder_at ? activity.reminder_at.slice(0, 16) : '',
        related_type: activity.related_type || '',
        related_id: activity.related_id || '',
        assignee_ids: activity.assignee_ids || [],
        watcher_ids: activity.watcher_ids || [],
        pendingTag: '',
      });
    }
  }, [activity]);

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async () => {
    if (!form.title.trim() || !activity) return alert('Title is required');
    const { pendingTag: _pendingTag, ...formFields } = form;
    const res = await apiFetch(`/api/activities/${activity.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...formFields,
        tags: commitPendingTag(form),
        due_date: form.due_date || null,
        reminder_at: form.reminder_at || null,
        related_type: form.related_type || null,
        related_id: form.related_type ? form.related_id.trim() || null : null,
      }),
    });
    if (res.ok) {
      onUpdate();
      onClose();
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Failed to update');
    }
  });

  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="Edit Task" wide closeOnBackdropClick={false}>
      <TaskForm form={form} setForm={setForm} existingTags={existingTags} assignableUsers={assignableUsers} />
      <div className="flex justify-end gap-2 pt-4">
        <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
        <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {submitting && <Loader2 className="inline size-4 animate-spin mr-1" />}
          Update
        </button>
      </div>
    </SimpleModal>
  );
}

// ---------- Delete Confirm Modal ----------
function DeleteConfirmModal({
  isOpen, onClose, onConfirm,
}: {
  isOpen: boolean; onClose: () => void; onConfirm: () => void | Promise<void>;
}) {
  const { run: handleConfirm, pending: deleting } = useAsyncAction(async () => { await onConfirm(); });
  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="Delete Task">
      <p>Are you sure you want to delete this task? It can only be recovered by an owner from the database.</p>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} disabled={deleting} className="px-4 py-2 border rounded disabled:opacity-50">Cancel</button>
        <button onClick={handleConfirm} disabled={deleting} className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50">
          {deleting && <Loader2 className="inline size-4 animate-spin mr-1" />}
          Delete
        </button>
      </div>
    </SimpleModal>
  );
}

// ---------- Checklist section (inside Task Details) ----------
function ChecklistSection({
  activityId, items, onChange,
}: {
  activityId: string; items: ChecklistItem[]; onChange: () => void;
}) {
  const [newText, setNewText] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const addItem = async () => {
    const text = newText.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const res = await apiFetch(`/api/activities/${activityId}/checklist`, { method: 'POST', body: JSON.stringify({ text }) });
      if (res.ok) { setNewText(''); onChange(); }
    } finally {
      setAdding(false);
    }
  };

  const toggleItem = async (item: ChecklistItem) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const res = await apiFetch(`/api/activities/${activityId}/checklist/${item.id}`, {
        method: 'PATCH', body: JSON.stringify({ is_done: !item.is_done }),
      });
      if (res.ok) onChange();
    } finally {
      setBusyId(null);
    }
  };

  const deleteItem = async (item: ChecklistItem) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const res = await apiFetch(`/api/activities/${activityId}/checklist/${item.id}`, { method: 'DELETE' });
      if (res.ok) onChange();
    } finally {
      setBusyId(null);
    }
  };

  const doneCount = items.filter(i => i.is_done).length;

  return (
    <div>
      <h4 className="font-medium text-sm mb-1">
        Checklist {items.length > 0 && <span className="text-xs text-gray-400">({doneCount}/{items.length})</span>}
      </h4>
      {items.length === 0 && <p className="text-xs text-gray-400 mb-1">No checklist items yet.</p>}
      <ul className="space-y-1 mb-2">
        {items.map(item => (
          <li key={item.id} className="flex items-center gap-2 text-sm group">
            <Checkbox checked={item.is_done} onCheckedChange={() => toggleItem(item)} disabled={busyId === item.id} />
            <span className={item.is_done ? 'line-through text-gray-400 flex-1' : 'flex-1'}>{item.text}</span>
            <button onClick={() => deleteItem(item)} disabled={busyId === item.id} className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <input
        type="text" placeholder="Add a checklist item, then press Enter" className="w-full border rounded p-1.5 text-sm"
        value={newText} onChange={e => setNewText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
        onBlur={addItem}
        disabled={adding}
      />
    </div>
  );
}

// ---------- Detail Modal (fetches full detail incl. history on open) ----------
function DetailModal({
  activityId, isOpen, onClose, isOwner, onUpdate, myId,
}: {
  activityId: string | null; isOpen: boolean; onClose: () => void; isOwner: boolean; onUpdate: () => void; myId: string | null;
}) {
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingIcs, setDownloadingIcs] = useState(false);

  const refetchDetail = async () => {
    if (!activityId) return;
    const res = await apiFetch(`/api/activities/${activityId}`);
    if (res.ok) setDetail(await res.json());
  };

  useEffect(() => {
    if (!isOpen || !activityId) { setDetail(null); return; }
    setLoading(true);
    apiFetch(`/api/activities/${activityId}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => setDetail(data))
      .finally(() => setLoading(false));
  }, [isOpen, activityId]);

  const handleChecklistChange = () => { refetchDetail(); onUpdate(); };

  const handleDownloadIcs = async () => {
    if (!activityId || downloadingIcs) return;
    setDownloadingIcs(true);
    try {
      const res = await apiFetch(`/api/activities/${activityId}/ics`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || 'Failed to export task to calendar.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activityId}.ics`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingIcs(false);
    }
  };

  const { run: markReviewed, pending: reviewing } = useAsyncAction(async () => {
    if (!activityId) return;
    const res = await apiFetch(`/api/activities/${activityId}`, { method: 'PUT', body: JSON.stringify({ mark_reviewed: true }) });
    if (res.ok) {
      onUpdate();
      const refreshed = await apiFetch(`/api/activities/${activityId}`);
      if (refreshed.ok) setDetail(await refreshed.json());
    }
  });

  if (!isOpen) return null;

  const linkBase = detail?.related_type ? RELATED_TYPE_LINK_BASE[detail.related_type] : undefined;

  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="Task Details" wide closeOnBackdropClick={false}>
      {loading && <p className="text-sm text-gray-500">Loading...</p>}
      {!loading && detail && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-lg">{detail.title}</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{detail.description || '—'}</p>
            </div>
            {detail.due_date && (
              <button
                onClick={handleDownloadIcs} disabled={downloadingIcs}
                className="shrink-0 text-xs px-2 py-1 border rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {downloadingIcs ? 'Exporting...' : 'Add to Calendar'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <p><strong>Status:</strong> <span className="capitalize">{detail.status.replace('_', ' ')}</span></p>
            <p><strong>Priority:</strong> <span className={`px-1.5 py-0.5 rounded text-xs ${PRIORITY_STYLES[detail.priority]}`}>{detail.priority}</span></p>
            <p><strong>Created by:</strong> {detail.created_by_name || '—'}</p>
            <p><strong>Assigned to:</strong> {detail.assignees.length > 0 ? detail.assignees.map(a => a.name).join(', ') : '(no one — personal task)'}</p>
            <p><strong>Watching:</strong> {detail.watchers.length > 0 ? detail.watchers.map(w => w.name).join(', ') : '—'}</p>
            <p><strong>Due Date:</strong> {detail.due_date ? format(new Date(detail.due_date), 'dd/MM/yyyy HH:mm') : '—'}</p>
            <p><strong>Reminder:</strong> {detail.reminder_at ? format(new Date(detail.reminder_at), 'dd/MM/yyyy HH:mm') : '—'}</p>
            <p><strong>Entry Date:</strong> {detail.created_at ? format(new Date(detail.created_at), 'dd/MM/yyyy HH:mm') : '—'}</p>
            <p><strong>Completed:</strong> {detail.completed_at ? `${format(new Date(detail.completed_at), 'dd/MM/yyyy HH:mm')} by ${detail.completed_by_name || '—'}` : '—'}</p>
            <p className="col-span-2">
              <strong>Related record:</strong>{' '}
              {detail.related_type && detail.related_id ? (
                linkBase
                  ? <Link href={`${linkBase}/${detail.related_id}`} className="text-blue-600 hover:underline" target="_blank">{RELATED_TYPE_LABELS[detail.related_type]}: {detail.related_id}</Link>
                  : <span>{RELATED_TYPE_LABELS[detail.related_type]}: {detail.related_id}</span>
              ) : '—'}
            </p>
            <p className="col-span-2">
              <strong>Reviewed:</strong>{' '}
              {detail.reviewed_at ? `${format(new Date(detail.reviewed_at), 'dd/MM/yyyy HH:mm')} by ${detail.reviewed_by_name || '—'}` : 'Not yet reviewed'}
              {isOwner && detail.status === 'done' && !detail.reviewed_at && (
                <button onClick={markReviewed} disabled={reviewing} className="ml-2 text-xs px-2 py-1 bg-green-600 text-white rounded disabled:opacity-50">
                  {reviewing ? 'Marking...' : 'Mark Reviewed'}
                </button>
              )}
            </p>
          </div>

          <ChecklistSection activityId={detail.id} items={detail.checklist} onChange={handleChecklistChange} />

          <div>
            <h4 className="font-medium text-sm mb-1">History</h4>
            {detail.history.length === 0 && <p className="text-xs text-gray-400">No changes recorded yet.</p>}
            <ul className="text-xs space-y-1 border-l-2 pl-3">
              {detail.history.map((h, i) => (
                <li key={i}>
                  <span className="text-gray-400">{format(new Date(h.changed_at), 'dd/MM/yyyy HH:mm')}</span>{' '}
                  — <strong>{h.changed_by_name || 'Unknown'}</strong> changed <em>{h.field_name}</em>: &quot;{h.old_value || '—'}&quot; → &quot;{h.new_value || '—'}&quot;
                </li>
              ))}
            </ul>
          </div>

          <ActivityCommentThread
            activityId={detail.id}
            myId={myId}
            isOwner={isOwner}
            canPin={isOwner || detail.created_by === myId}
            mentionPool={[
              ...detail.assignees.map(a => ({ id: a.user_id, name: a.name || 'Unknown user' })),
              ...detail.watchers.map(w => ({ id: w.user_id, name: w.name || 'Unknown user' })),
              { id: detail.created_by, name: detail.created_by_name || 'Unknown user' },
            ].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i && c.id !== myId)}
          />
        </div>
      )}
    </SimpleModal>
  );
}

// ---------- Main ActivityList Component ----------
export default function ActivityList({ onUpdate }: { onUpdate: () => void }) {
  const { isOwner } = useRole();
  const searchParams = useSearchParams();
  const [myId, setMyId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['pending', 'in_progress', 'done']);
  const [tagFilter, setTagFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sortBy, setSortBy] = useState('due_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [existingTags, setExistingTags] = useState<string[]>([]);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
  }, []);

  // A notification's link (?open=<id>) deep-links straight into that task's
  // detail view -- DetailModal fetches by id independently, so this works
  // even if the task is filtered out of the current list view.
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId) setSelectedActivityId(openId);
  }, [searchParams]);

  useEffect(() => {
    apiFetch('/api/tags').then(res => res.ok ? res.json() : []).then(setExistingTags);
    apiFetch('/api/activities/assignable-users').then(res => res.ok ? res.json() : []).then((users: AssignableUser[]) => {
      setAssignableUsers(myId ? users.filter(u => u.id !== myId) : users);
    });
  }, [myId]);

  // Debounce the search box -- without this, every keystroke fired a full
  // network round-trip, which read as the search "working alphabet by
  // alphabet" while the user was still typing the string.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchActivities = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedStatuses.length > 0 && selectedStatuses.length < 4) {
      params.append('status', selectedStatuses.join(','));
    }
    if (tagFilter) params.append('tag', tagFilter);
    if (debouncedSearch) params.append('search', debouncedSearch);
    params.append('sort_by', sortBy);
    params.append('sort_order', sortOrder);
    const res = await apiFetch(`/api/activities?${params.toString()}`);
    const data = await res.json();
    if (res.ok) setActivities(data);
    setLoading(false);
  };

  useEffect(() => { fetchActivities(); }, [selectedStatuses, tagFilter, debouncedSearch, sortBy, sortOrder]);

  const triggerReload = () => { onUpdate(); fetchActivities(); };

  const toggleStatus = (status: string) => {
    setSelectedStatuses(prev => prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]);
  };

  const handleSort = (column: string) => {
    if (sortBy === column) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortBy(column); setSortOrder('asc'); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const res = await apiFetch(`/api/activities/${deleteId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Failed to delete');
    }
    triggerReload();
    setDeleteId(null);
  };

  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const duplicatingRef = useRef<Set<string>>(new Set());
  const handleDuplicate = async (act: Activity) => {
    if (duplicatingRef.current.has(act.id)) return;
    duplicatingRef.current.add(act.id);
    setDuplicatingId(act.id);
    try {
      await apiFetch('/api/activities', {
        method: 'POST',
        body: JSON.stringify({
          title: `${act.title} (copy)`, description: act.description, tags: act.tags,
          status: 'pending', priority: act.priority, due_date: act.due_date, reminder_at: act.reminder_at,
          related_type: act.related_type, related_id: act.related_id, assignee_ids: act.assignee_ids,
          watcher_ids: act.watcher_ids,
        }),
      });
      triggerReload();
    } finally {
      duplicatingRef.current.delete(act.id);
      setDuplicatingId(prev => (prev === act.id ? null : prev));
    }
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return null;
    return sortOrder === 'asc' ? <ArrowUp className="h-3 w-3 ml-1 inline" /> : <ArrowDown className="h-3 w-3 ml-1 inline" />;
  };

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-2 flex-wrap items-end">
          <div>
            <label className="block text-sm font-medium mb-1">Search</label>
            <input type="text" placeholder="Title or description..." value={search} onChange={e => setSearch(e.target.value)} className="border rounded p-2 w-64" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Filter by tags</label>
            <input type="text" placeholder="Tag name" value={tagFilter} onChange={e => setTagFilter(e.target.value)} className="border rounded p-2 w-40" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <div className="flex gap-2">
              {(['pending', 'in_progress', 'done', 'cancelled'] as const).map(status => (
                <label key={status} className="flex items-center gap-1">
                  <Checkbox checked={selectedStatuses.includes(status)} onCheckedChange={() => toggleStatus(status)} />
                  <span className="capitalize">{status.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <button onClick={() => setShowAddModal(true)} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          + New Task
        </button>
      </div>

      {isOwner && <p className="text-xs text-gray-500">Showing every task (owner view). Employees only see tasks they created or are assigned to.</p>}

      <div className="border rounded overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('due_date')}>
                Due Date <SortIcon column="due_date" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('title')}>
                Title <SortIcon column="title" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('priority')}>
                Priority <SortIcon column="priority" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assigned To</th>
              {isOwner && <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created By</th>}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('status')}>
                Status <SortIcon column="status" />
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {activities.map(act => {
              const overdue = act.due_date && act.status !== 'done' && act.status !== 'cancelled' && new Date(act.due_date) < new Date();
              const canDelete = isOwner || act.created_by === myId;
              return (
                <tr key={act.id} className={act.status === 'done' ? 'opacity-50' : overdue ? 'bg-red-50' : ''}>
                  <td className="px-4 py-3">
                    {act.due_date ? format(new Date(act.due_date), 'dd/MM/yyyy') : '-'}
                    {overdue && <span className="ml-1 text-xs text-red-600 font-medium">overdue</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelectedActivityId(act.id)} className="text-blue-600 hover:underline text-left">
                      {act.title}
                    </button>
                    {!!act.checklist_total && (
                      <span className="ml-1.5 text-xs text-gray-400 align-middle">({act.checklist_done}/{act.checklist_total})</span>
                    )}
                    {act.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {act.tags.map(tag => (
                          <span key={tag} style={{ backgroundColor: getTagColor(tag) }} className="px-1.5 py-0.5 rounded text-xs">{tag}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-xs ${PRIORITY_STYLES[act.priority]}`}>{act.priority}</span></td>
                  <td className="px-4 py-3 text-sm">{act.assignee_names.length > 0 ? act.assignee_names.join(', ') : <span className="text-gray-400">—</span>}</td>
                  {isOwner && <td className="px-4 py-3 text-sm">{act.created_by_name || '—'}</td>}
                  <td className="px-4 py-3 capitalize">{act.status.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => setEditingActivity(act)} className="text-gray-600 hover:text-blue-600"><Edit className="h-4 w-4 inline" /></button>
                    <button onClick={() => handleDuplicate(act)} disabled={duplicatingId === act.id} className="text-gray-600 hover:text-green-600 disabled:opacity-50">
                      {duplicatingId === act.id ? <Loader2 className="h-4 w-4 inline animate-spin" /> : <Copy className="h-4 w-4 inline" />}
                    </button>
                    {canDelete && (
                      <button onClick={() => setDeleteId(act.id)} className="text-gray-600 hover:text-red-600"><Trash2 className="h-4 w-4 inline" /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AddActivityModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onUpdate={triggerReload} existingTags={existingTags} assignableUsers={assignableUsers} />
      <EditActivityModal activity={editingActivity} isOpen={!!editingActivity} onClose={() => setEditingActivity(null)} onUpdate={triggerReload} existingTags={existingTags} assignableUsers={assignableUsers} />
      <DetailModal activityId={selectedActivityId} isOpen={!!selectedActivityId} onClose={() => setSelectedActivityId(null)} isOwner={isOwner} onUpdate={triggerReload} myId={myId} />
      <DeleteConfirmModal isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} />
    </div>
  );
}
