'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { Edit, Trash2, Copy, X, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { useRole } from '@/lib/auth/useRole';
import { apiFetch } from '@/lib/api-client';
import { createClient } from '@/lib/supabase/client';
import ActivityCommentThread from '@/components/ActivityCommentThread';

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
  related_type?: RelatedType | null;
  related_id?: string | null;
  completed_at?: string | null;
  reviewed_at?: string | null;
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
function SimpleModal({
  isOpen, onClose, title, children, wide,
}: {
  isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className={`bg-white rounded-lg ${wide ? 'max-w-2xl' : 'max-w-lg'} w-full mx-4 p-6 max-h-[85vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

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
}

function TaskForm({
  form, setForm, existingTags, assignableUsers,
}: {
  form: TaskFormState;
  setForm: (updater: (prev: TaskFormState) => TaskFormState) => void;
  existingTags: string[];
  assignableUsers: AssignableUser[];
}) {
  const [tagInput, setTagInput] = useState('');

  const handleAddTag = () => {
    const newTag = tagInput.trim();
    if (newTag && !form.tags.includes(newTag)) {
      setForm(prev => ({ ...prev, tags: [...prev.tags, newTag] }));
      setTagInput('');
    }
  };
  const removeTag = (tag: string) => setForm(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  const toggleAssignee = (userId: string) => {
    setForm(prev => ({
      ...prev,
      assignee_ids: prev.assignee_ids.includes(userId)
        ? prev.assignee_ids.filter(id => id !== userId)
        : [...prev.assignee_ids, userId],
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
              <input type="checkbox" checked={form.assignee_ids.includes(u.id)} onChange={() => toggleAssignee(u.id)} />
              {userLabel(u)} <span className="text-xs text-gray-400">({u.role})</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">Leave empty for a personal task (only you and the owner will see it).</p>
      </div>

      <div>
        <label className="block text-sm font-medium">Tags</label>
        <div className="flex gap-2">
          <input
            list="tag-suggestions" className="border rounded p-2 flex-1" placeholder="Select or type new tag"
            value={tagInput} onChange={e => setTagInput(e.target.value)}
          />
          <datalist id="tag-suggestions">
            {existingTags.map(tag => <option key={tag} value={tag} />)}
          </datalist>
          <button type="button" onClick={handleAddTag} className="bg-gray-200 px-3 rounded">Add</button>
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

const EMPTY_FORM: TaskFormState = {
  title: '', description: '', tags: [], status: 'pending', priority: 'normal',
  due_date: '', reminder_at: '', related_type: '', related_id: '', assignee_ids: [],
};

// ---------- Add Activity Modal ----------
function AddActivityModal({
  isOpen, onClose, onUpdate, existingTags, assignableUsers,
}: {
  isOpen: boolean; onClose: () => void; onUpdate: () => void; existingTags: string[]; assignableUsers: AssignableUser[];
}) {
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async () => {
    if (!form.title.trim()) return alert('Title is required');
    const res = await apiFetch('/api/activities', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        due_date: form.due_date || null,
        reminder_at: form.reminder_at || null,
        related_type: form.related_type || null,
        related_id: form.related_type ? form.related_id.trim() || null : null,
      }),
    });
    if (res.ok) {
      onUpdate();
      onClose();
      setForm(EMPTY_FORM);
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Failed to add task');
    }
  });

  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="New Task" wide>
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
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);

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
      });
    }
  }, [activity]);

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async () => {
    if (!form.title.trim() || !activity) return alert('Title is required');
    const res = await apiFetch(`/api/activities/${activity.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...form,
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
    <SimpleModal isOpen={isOpen} onClose={onClose} title="Edit Task" wide>
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

// ---------- Detail Modal (fetches full detail incl. history on open) ----------
function DetailModal({
  activityId, isOpen, onClose, isOwner, onUpdate, myId,
}: {
  activityId: string | null; isOpen: boolean; onClose: () => void; isOwner: boolean; onUpdate: () => void; myId: string | null;
}) {
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !activityId) { setDetail(null); return; }
    setLoading(true);
    apiFetch(`/api/activities/${activityId}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => setDetail(data))
      .finally(() => setLoading(false));
  }, [isOpen, activityId]);

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
    <SimpleModal isOpen={isOpen} onClose={onClose} title="Task Details" wide>
      {loading && <p className="text-sm text-gray-500">Loading...</p>}
      {!loading && detail && (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-lg">{detail.title}</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{detail.description || '—'}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <p><strong>Status:</strong> <span className="capitalize">{detail.status.replace('_', ' ')}</span></p>
            <p><strong>Priority:</strong> <span className={`px-1.5 py-0.5 rounded text-xs ${PRIORITY_STYLES[detail.priority]}`}>{detail.priority}</span></p>
            <p><strong>Created by:</strong> {detail.created_by_name || '—'}</p>
            <p><strong>Assigned to:</strong> {detail.assignees.length > 0 ? detail.assignees.map(a => a.name).join(', ') : '(no one — personal task)'}</p>
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
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sortBy, setSortBy] = useState('entry_date');
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

  const fetchActivities = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedStatuses.length > 0 && selectedStatuses.length < 4) {
      params.append('status', selectedStatuses.join(','));
    }
    if (tagFilter) params.append('tag', tagFilter);
    if (search) params.append('search', search);
    params.append('sort_by', sortBy);
    params.append('sort_order', sortOrder);
    const res = await apiFetch(`/api/activities?${params.toString()}`);
    const data = await res.json();
    if (res.ok) setActivities(data);
    setLoading(false);
  };

  useEffect(() => { fetchActivities(); }, [selectedStatuses, tagFilter, search, sortBy, sortOrder]);

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
                  <input type="checkbox" checked={selectedStatuses.includes(status)} onChange={() => toggleStatus(status)} className="rounded" />
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
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('due_date')}>
                Due Date <SortIcon column="due_date" />
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
                    <button onClick={() => setSelectedActivityId(act.id)} className="text-blue-600 hover:underline text-left">
                      {act.title}
                    </button>
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
                  <td className="px-4 py-3">
                    {act.due_date ? format(new Date(act.due_date), 'dd/MM/yyyy') : '-'}
                    {overdue && <span className="ml-1 text-xs text-red-600 font-medium">overdue</span>}
                  </td>
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
