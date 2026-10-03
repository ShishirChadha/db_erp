'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, Trash2, Copy, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { useRole } from '@/lib/auth/useRole';
import { apiFetch } from '@/lib/api-client';
import { useCustomOptions } from '@/lib/useCustomOptions';
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport';
import { useResizablePaneWidth } from '@/lib/useResizablePaneWidth';
import { cn } from '@/lib/utils';
import ActivityCommentThread from '@/components/ActivityCommentThread';
import ActivityDescriptionTable, { DescriptionTableData, tableFromPastedText } from '@/components/ActivityDescriptionTable';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleModal } from '@/components/SimpleModal';

// ---------- Type definitions ----------
type Priority = 'low' | 'normal' | 'high' | 'urgent';
type Status = 'pending' | 'in_progress' | 'done' | 'cancelled';
type RelatedType = 'customer' | 'sale' | 'purchase_order' | 'asset' | 'repair_job' | 'invoice' | 'vendor' | 'recurring_expense' | 'marketing_asset';

interface Activity {
  id: string;
  title: string;
  description?: string | null;
  description_table?: DescriptionTableData | null;
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
  recurring_expense: 'Recurring Expense', marketing_asset: 'Marketing Content',
};
// Only record types with a real detail route get a clickable deep link; the rest show as plain text.
const RELATED_TYPE_LINK_BASE: Partial<Record<RelatedType, string>> = {
  asset: '/dashboard/stock', purchase_order: '/dashboard/purchase-orders', invoice: '/dashboard/invoices',
  marketing_asset: '/dashboard/marketing',
};

const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'bg-muted text-muted-foreground', normal: 'bg-info/15 text-info',
  high: 'bg-warning/15 text-warning', urgent: 'bg-destructive/10 text-destructive',
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

// A Description box that grows to fit its content instead of scrolling inside
// a fixed 3-row box -- resizes on every keystroke (onInput) and whenever the
// value changes from outside typing (loading a task's existing description,
// switching tasks), so a long description is never clipped on first render.
function AutoGrowTextarea({
  value, onChange, onBlur, onPaste, className, placeholder,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={3}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onPaste={onPaste}
      placeholder={placeholder}
      onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }}
      className={cn('resize-none overflow-hidden', className)}
    />
  );
}

// ---------- Shared task field set (create form + the detail pane's inline editor) ----------
interface TaskFormState {
  title: string;
  description: string;
  description_table: DescriptionTableData | null;
  tags: string[];
  status: Status;
  priority: Priority;
  due_date: string;
  reminder_at: string;
  related_type: RelatedType | '';
  related_id: string;
  assignee_ids: string[];
  watcher_ids: string[];
}

function TaskForm({
  form, setForm, tagOptions, assignableUsers,
}: {
  form: TaskFormState;
  setForm: (updater: (prev: TaskFormState) => TaskFormState) => void;
  tagOptions: string[];
  assignableUsers: AssignableUser[];
}) {
  // Pasting a tab-separated range (from Excel/Numbers/Sheets) into Description
  // is tabular data, not a paragraph -- divert it into the table below instead
  // of dumping raw tab characters into the plain-text field. A normal
  // (non-tabular) paste falls through to the textarea as usual.
  const handleDescriptionPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const parsed = tableFromPastedText(e.clipboardData.getData('text/plain'));
    if (!parsed) return;
    e.preventDefault();
    setForm(prev => ({ ...prev, description_table: parsed }));
  };

  const toggleTag = (tag: string) => {
    setForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag],
    }));
  };
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
        <AutoGrowTextarea
          className="w-full border rounded p-2" value={form.description}
          onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
          onPaste={handleDescriptionPaste}
        />
        <p className="text-xs text-muted-foreground mt-1">Tip: pasting a copied spreadsheet range here builds a table below instead of raw text.</p>
      </div>

      <ActivityDescriptionTable
        table={form.description_table}
        onChange={t => setForm(prev => ({ ...prev, description_table: t }))}
      />

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
          {assignableUsers.length === 0 && <p className="text-xs text-muted-foreground">No other users found.</p>}
          {assignableUsers.map(u => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.assignee_ids.includes(u.id)} onCheckedChange={() => toggleAssignee(u.id)} />
              {userLabel(u)} <span className="text-xs text-muted-foreground">({u.role})</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Leave empty for a personal task (only you and the owner will see it).</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Watchers (CC — can see the task, not assigned to do it)</label>
        <div className="border rounded p-2 max-h-32 overflow-y-auto space-y-1">
          {assignableUsers.filter(u => !form.assignee_ids.includes(u.id)).length === 0 && (
            <p className="text-xs text-muted-foreground">No other users available to watch.</p>
          )}
          {assignableUsers.filter(u => !form.assignee_ids.includes(u.id)).map(u => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.watcher_ids.includes(u.id)} onCheckedChange={() => toggleWatcher(u.id)} />
              {userLabel(u)} <span className="text-xs text-muted-foreground">({u.role})</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">e.g. a manager who should see this task without owning the work — they get visibility and a notification, but the task stays assigned to whoever&apos;s checked above.</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Tags</label>
        <div className="border rounded p-2 max-h-32 overflow-y-auto space-y-1">
          {tagOptions.length === 0 && <p className="text-xs text-muted-foreground">No tags available yet — ask the owner to add some in Settings.</p>}
          {tagOptions.map(tag => (
            <label key={tag} className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.tags.includes(tag)} onCheckedChange={() => toggleTag(tag)} />
              {tag}
            </label>
          ))}
        </div>
        {form.tags.some(tag => !tagOptions.includes(tag)) && (
          <div className="mt-1">
            <p className="text-xs text-muted-foreground">From before tags were locked to a list (no longer selectable, only removable):</p>
            {form.tags.filter(tag => !tagOptions.includes(tag)).map(tag => (
              <label key={tag} className="flex items-center gap-2 text-sm">
                <Checkbox checked={true} onCheckedChange={() => toggleTag(tag)} />
                {tag}
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-1">Pick from the list — only the owner can add a new tag (Settings → Activity Tags).</p>
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
    title: '', description: '', description_table: null, tags: [], status: 'pending', priority: 'normal',
    due_date: format(due, "yyyy-MM-dd'T'HH:mm"),
    reminder_at: format(reminder, "yyyy-MM-dd'T'HH:mm"),
    related_type: '', related_id: '', assignee_ids: [], watcher_ids: [],
  };
}

// The single-task GET endpoint's response doesn't carry flat assignee_ids/
// watcher_ids (those only exist on the list endpoint's enriched rows) -- it
// has the richer `assignees`/`watchers` objects instead, so those are what
// this derives the editable id arrays from.
function activityToFormState(activity: ActivityDetail): TaskFormState {
  return {
    title: activity.title || '',
    description: activity.description || '',
    description_table: activity.description_table || null,
    tags: activity.tags || [],
    status: activity.status || 'pending',
    priority: activity.priority || 'normal',
    due_date: activity.due_date ? activity.due_date.slice(0, 16) : '',
    reminder_at: activity.reminder_at ? activity.reminder_at.slice(0, 16) : '',
    related_type: activity.related_type || '',
    related_id: activity.related_id || '',
    assignee_ids: activity.assignees?.map(a => a.user_id) || [],
    watcher_ids: activity.watchers?.map(w => w.user_id) || [],
  };
}

// ---------- Add Activity Modal (creation only -- editing happens inline in the detail pane) ----------
function AddActivityModal({
  isOpen, onClose, onUpdate, tagOptions, assignableUsers,
}: {
  isOpen: boolean; onClose: () => void; onUpdate: () => void; tagOptions: string[]; assignableUsers: AssignableUser[];
}) {
  const [form, setForm] = useState<TaskFormState>(buildEmptyForm);
  // Bumped on every open so TaskForm (and its ActivityDescriptionTable child,
  // which owns its own local edit state) fully remounts rather than carrying
  // over a table pasted into a previous, since-abandoned draft.
  const [formInstance, setFormInstance] = useState(0);

  // Fresh defaults every time the modal is opened (including reopen-after-cancel),
  // not just after a successful submit -- so the due-date/reminder defaults
  // never go stale relative to "now".
  useEffect(() => {
    if (isOpen) { setForm(buildEmptyForm()); setFormInstance(n => n + 1); }
  }, [isOpen]);

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
      setForm(buildEmptyForm());
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Failed to add task');
    }
  });

  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="New Task" wide closeOnBackdropClick={false}>
      <TaskForm key={formInstance} form={form} setForm={setForm} tagOptions={tagOptions} assignableUsers={assignableUsers} />
      <div className="flex justify-end gap-2 pt-4">
        <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
        <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50">
          {submitting && <Loader2 className="inline size-4 animate-spin mr-1" />}
          Save
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
        <button onClick={handleConfirm} disabled={deleting} className="px-4 py-2 bg-destructive text-destructive-foreground rounded disabled:opacity-50">
          {deleting && <Loader2 className="inline size-4 animate-spin mr-1" />}
          Delete
        </button>
      </div>
    </SimpleModal>
  );
}

// ---------- Checklist section (inside the detail pane) ----------
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
        Checklist {items.length > 0 && <span className="text-xs text-muted-foreground">({doneCount}/{items.length})</span>}
      </h4>
      {items.length === 0 && <p className="text-xs text-muted-foreground mb-1">No checklist items yet.</p>}
      <ul className="space-y-1 mb-2">
        {items.map(item => (
          <li key={item.id} className="flex items-center gap-2 text-sm group">
            <Checkbox checked={item.is_done} onCheckedChange={() => toggleItem(item)} disabled={busyId === item.id} />
            <span className={item.is_done ? 'line-through text-muted-foreground flex-1' : 'flex-1'}>{item.text}</span>
            <button onClick={() => deleteItem(item)} disabled={busyId === item.id} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100">
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

// ---------- List pane row ----------
function ActivityListRow({ activity, active, isOwner, onOpen }: {
  activity: Activity; active: boolean; isOwner: boolean; onOpen: () => void;
}) {
  const overdue = activity.due_date && activity.status !== 'done' && activity.status !== 'cancelled' && new Date(activity.due_date) < new Date();
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-border transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted',
        activity.status === 'done' && 'opacity-60'
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm text-foreground truncate">{activity.title}</span>
        <span className={cn('shrink-0 px-1.5 py-0.5 rounded text-xs', PRIORITY_STYLES[activity.priority])}>{activity.priority}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1 text-xs text-muted-foreground">
        <span className="truncate">
          {activity.due_date ? format(new Date(activity.due_date), 'dd/MM/yyyy') : 'No due date'}
          {overdue && <span className="ml-1 text-destructive font-medium">overdue</span>}
        </span>
        <span className="capitalize shrink-0">{activity.status.replace('_', ' ')}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1 text-xs text-muted-foreground">
        <span className="truncate">
          {activity.assignee_names.length > 0 ? activity.assignee_names.join(', ') : '—'}
          {isOwner && activity.created_by_name ? ` · by ${activity.created_by_name}` : ''}
        </span>
        {!!activity.checklist_total && <span className="shrink-0">({activity.checklist_done}/{activity.checklist_total})</span>}
      </div>
      {activity.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {activity.tags.map(tag => (
            <span key={tag} style={{ backgroundColor: getTagColor(tag) }} className="px-1.5 py-0.5 rounded text-xs">{tag}</span>
          ))}
        </div>
      )}
    </button>
  );
}

// ---------- Detail pane: view + fully inline-editable fields, right side of the split ----------
function ActivityDetailPane({
  activityId, isOwner, myId, tagOptions, assignableUsers, onBack, onUpdate, onDeleted,
}: {
  activityId: string; isOwner: boolean; myId: string | null; tagOptions: string[]; assignableUsers: AssignableUser[];
  onBack: () => void; onUpdate: () => void; onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<TaskFormState>(buildEmptyForm);
  const [downloadingIcs, setDownloadingIcs] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const refetchDetail = async () => {
    const res = await apiFetch(`/api/activities/${activityId}`);
    if (res.ok) {
      const data = await res.json();
      setDetail(data);
      setFields(activityToFormState(data));
    }
  };

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/activities/${activityId}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) { setDetail(data); setFields(activityToFormState(data)); } })
      .finally(() => setLoading(false));
  }, [activityId]);

  // Structural/discrete field changes (select, checkbox, table edit) save
  // immediately; text fields (title/description/dates/related id) only call
  // this on blur -- see the input handlers below. Always optimistic-updates
  // `fields` first so typing/toggling feels instant regardless of network.
  const saveFields = async (next: TaskFormState) => {
    setFields(next);
    const res = await apiFetch(`/api/activities/${activityId}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...next,
        due_date: next.due_date || null,
        reminder_at: next.reminder_at || null,
        related_type: next.related_type || null,
        related_id: next.related_type ? next.related_id.trim() || null : null,
      }),
    });
    if (res.ok) { onUpdate(); refetchDetail(); }
    else {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Failed to save changes.');
    }
  };

  const handleChecklistChange = () => { refetchDetail(); onUpdate(); };

  const handleTableChange = (table: DescriptionTableData | null) => {
    saveFields({ ...fields, description_table: table });
  };

  const handleDescriptionPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const parsed = tableFromPastedText(e.clipboardData.getData('text/plain'));
    if (!parsed) return;
    e.preventDefault();
    saveFields({ ...fields, description_table: parsed });
  };

  const toggleTag = (tag: string) => {
    const tags = fields.tags.includes(tag) ? fields.tags.filter(t => t !== tag) : [...fields.tags, tag];
    saveFields({ ...fields, tags });
  };
  const toggleAssignee = (userId: string) => {
    const assignee_ids = fields.assignee_ids.includes(userId)
      ? fields.assignee_ids.filter(id => id !== userId)
      : [...fields.assignee_ids, userId];
    saveFields({ ...fields, assignee_ids, watcher_ids: fields.watcher_ids.filter(id => id !== userId) });
  };
  const toggleWatcher = (userId: string) => {
    const watcher_ids = fields.watcher_ids.includes(userId)
      ? fields.watcher_ids.filter(id => id !== userId)
      : [...fields.watcher_ids, userId];
    saveFields({ ...fields, watcher_ids });
  };

  const handleDownloadIcs = async () => {
    if (downloadingIcs) return;
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
    const res = await apiFetch(`/api/activities/${activityId}`, { method: 'PUT', body: JSON.stringify({ mark_reviewed: true }) });
    if (res.ok) { onUpdate(); refetchDetail(); }
  });

  const handleDuplicate = async () => {
    if (!detail || duplicating) return;
    setDuplicating(true);
    try {
      await apiFetch('/api/activities', {
        method: 'POST',
        body: JSON.stringify({
          title: `${detail.title} (copy)`, description: detail.description, tags: fields.tags,
          status: 'pending', priority: detail.priority, due_date: detail.due_date, reminder_at: detail.reminder_at,
          related_type: detail.related_type, related_id: detail.related_id, assignee_ids: fields.assignee_ids,
          watcher_ids: fields.watcher_ids,
        }),
      });
      onUpdate();
    } finally {
      setDuplicating(false);
    }
  };

  const handleDelete = async () => {
    const res = await apiFetch(`/api/activities/${activityId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Failed to delete');
    }
    setConfirmingDelete(false);
    onDeleted();
  };

  const linkBase = fields.related_type ? RELATED_TYPE_LINK_BASE[fields.related_type] : undefined;
  const canDelete = !!detail && (isOwner || detail.created_by === myId);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-0">
        <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" /> Back to list
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-3 border-b border-border">
          {detail?.due_date && (
            <button onClick={handleDownloadIcs} disabled={downloadingIcs} className="text-xs px-2 py-1 border rounded text-muted-foreground hover:bg-muted disabled:opacity-50">
              {downloadingIcs ? 'Exporting...' : 'Add to Calendar'}
            </button>
          )}
          <button onClick={handleDuplicate} disabled={duplicating} className="text-xs px-2 py-1 border rounded text-muted-foreground hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1">
            {duplicating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />} Duplicate
          </button>
          {canDelete && (
            <button onClick={() => setConfirmingDelete(true)} className="text-xs px-2 py-1 border rounded text-destructive hover:bg-destructive/10 inline-flex items-center gap-1">
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          )}
          {isOwner && detail?.status === 'done' && !detail.reviewed_at && (
            <button onClick={markReviewed} disabled={reviewing} className="text-xs px-2 py-1 bg-success text-success-foreground rounded disabled:opacity-50 ml-auto">
              {reviewing ? 'Marking...' : 'Mark Reviewed'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pt-3">
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {!loading && detail && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
              <input
                className="w-full border rounded p-2 font-semibold text-lg"
                value={fields.title}
                onChange={e => setFields(prev => ({ ...prev, title: e.target.value }))}
                onBlur={() => saveFields(fields)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
              <AutoGrowTextarea
                className="w-full border rounded p-2 text-sm"
                value={fields.description}
                onChange={e => setFields(prev => ({ ...prev, description: e.target.value }))}
                onBlur={() => saveFields(fields)}
                onPaste={handleDescriptionPaste}
              />
            </div>

            <ActivityDescriptionTable table={fields.description_table} onChange={handleTableChange} />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Priority</label>
                <select
                  className="w-full border rounded p-2 text-sm"
                  value={fields.priority}
                  onChange={e => saveFields({ ...fields, priority: e.target.value as Priority })}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
                <select
                  className="w-full border rounded p-2 text-sm"
                  value={fields.status}
                  onChange={e => saveFields({ ...fields, status: e.target.value as Status })}
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Due Date</label>
                <input
                  type="datetime-local" className="w-full border rounded p-2 text-sm"
                  value={fields.due_date}
                  onChange={e => setFields(prev => ({ ...prev, due_date: e.target.value }))}
                  onBlur={() => saveFields(fields)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Reminder</label>
                <input
                  type="datetime-local" className="w-full border rounded p-2 text-sm"
                  value={fields.reminder_at}
                  onChange={e => setFields(prev => ({ ...prev, reminder_at: e.target.value }))}
                  onBlur={() => saveFields(fields)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Assigned to</label>
              <div className="border rounded p-2 max-h-32 overflow-y-auto space-y-1">
                {assignableUsers.length === 0 && <p className="text-xs text-muted-foreground">No other users found.</p>}
                {assignableUsers.map(u => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={fields.assignee_ids.includes(u.id)} onCheckedChange={() => toggleAssignee(u.id)} />
                    {userLabel(u)} <span className="text-xs text-muted-foreground">({u.role})</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Watchers (CC)</label>
              <div className="border rounded p-2 max-h-32 overflow-y-auto space-y-1">
                {assignableUsers.filter(u => !fields.assignee_ids.includes(u.id)).length === 0 && (
                  <p className="text-xs text-muted-foreground">No other users available to watch.</p>
                )}
                {assignableUsers.filter(u => !fields.assignee_ids.includes(u.id)).map(u => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={fields.watcher_ids.includes(u.id)} onCheckedChange={() => toggleWatcher(u.id)} />
                    {userLabel(u)} <span className="text-xs text-muted-foreground">({u.role})</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Tags</label>
              <div className="border rounded p-2 max-h-32 overflow-y-auto space-y-1">
                {tagOptions.length === 0 && <p className="text-xs text-muted-foreground">No tags available yet — ask the owner to add some in Settings.</p>}
                {tagOptions.map(tag => (
                  <label key={tag} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={fields.tags.includes(tag)} onCheckedChange={() => toggleTag(tag)} />
                    {tag}
                  </label>
                ))}
              </div>
              {fields.tags.some(tag => !tagOptions.includes(tag)) && (
                <div className="mt-1">
                  <p className="text-xs text-muted-foreground">From before tags were locked to a list (no longer selectable, only removable):</p>
                  {fields.tags.filter(tag => !tagOptions.includes(tag)).map(tag => (
                    <label key={tag} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={true} onCheckedChange={() => toggleTag(tag)} />
                      {tag}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Link to a record (optional)</label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="border rounded p-2 text-sm"
                  value={fields.related_type}
                  onChange={e => saveFields({ ...fields, related_type: e.target.value as RelatedType | '', related_id: '' })}
                >
                  <option value="">None</option>
                  {(Object.keys(RELATED_TYPE_LABELS) as RelatedType[]).map(t => (
                    <option key={t} value={t}>{RELATED_TYPE_LABELS[t]}</option>
                  ))}
                </select>
                <input
                  type="text" placeholder="Record ID" className="border rounded p-2 text-sm"
                  value={fields.related_id}
                  onChange={e => setFields(prev => ({ ...prev, related_id: e.target.value }))}
                  onBlur={() => saveFields(fields)}
                  disabled={!fields.related_type}
                />
              </div>
              {fields.related_type && fields.related_id && linkBase && (
                <Link href={`${linkBase}/${fields.related_id}`} className="text-xs text-primary hover:underline" target="_blank">
                  View {RELATED_TYPE_LABELS[fields.related_type]} →
                </Link>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground border-t border-border pt-3">
              <p>Created by {detail.created_by_name || '—'}</p>
              <p>Entry: {detail.created_at ? format(new Date(detail.created_at), 'dd/MM/yyyy HH:mm') : '—'}</p>
              <p>Completed: {detail.completed_at ? `${format(new Date(detail.completed_at), 'dd/MM/yyyy HH:mm')} by ${detail.completed_by_name || '—'}` : '—'}</p>
              <p>Reviewed: {detail.reviewed_at ? `${format(new Date(detail.reviewed_at), 'dd/MM/yyyy HH:mm')} by ${detail.reviewed_by_name || '—'}` : 'Not yet'}</p>
            </div>

            <ChecklistSection activityId={detail.id} items={detail.checklist} onChange={handleChecklistChange} />

            <div>
              <h4 className="font-medium text-sm mb-1">History</h4>
              {detail.history.length === 0 && <p className="text-xs text-muted-foreground">No changes recorded yet.</p>}
              <ul className="text-xs space-y-1 border-l-2 pl-3">
                {detail.history.map((h, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">{format(new Date(h.changed_at), 'dd/MM/yyyy HH:mm')}</span>{' '}
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
      </div>

      <DeleteConfirmModal isOpen={confirmingDelete} onClose={() => setConfirmingDelete(false)} onConfirm={handleDelete} />
    </div>
  );
}

// ---------- Main ActivityList Component ----------
export default function ActivityList({ onUpdate }: { onUpdate: () => void }) {
  // Resolved server-side already by RoleProvider (seeded from
  // dashboard/layout.tsx, no network call) -- this used to be its own
  // createClient().auth.getUser() call, a redundant network round trip to
  // Supabase Auth that also contended with every other auth-touching call
  // this page fires on mount for the same shared client's session lock.
  const { isOwner, userId: myId } = useRole();
  const searchParams = useSearchParams();
  const isDesktop = useIsDesktopViewport();
  const { width: listPaneWidth, handleMouseDown: handlePaneResize } = useResizablePaneWidth('activity-list-pane-width');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['pending', 'in_progress', 'done']);
  const [tagFilter, setTagFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sortBy, setSortBy] = useState('due_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const { values: tagOptions } = useCustomOptions('activity_tags');

  // A notification's link (?open=<id>) deep-links straight into that task's
  // detail pane -- fetched by id independently, so this works even if the
  // task is filtered out of the current list view.
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId) setSelectedActivityId(openId);
  }, [searchParams]);

  useEffect(() => {
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

  // `silent` skips the loading-flag toggle -- used for a background reload
  // triggered by an action inside the open detail pane (e.g. editing a
  // task's table, toggling a checklist item). Setting `loading` there used to
  // make the whole component render its "Loading..." placeholder instead of
  // its tree, which unmounts the detail pane along with it for the duration
  // of the fetch -- felt like the page "refreshing" on every single edit. The
  // plain (non-silent) path is only for filter/sort/search changes and the
  // very first mount, where the pane layout doesn't need to survive a swap.
  const fetchActivities = async (silent = false) => {
    if (!silent) setLoading(true);
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
    if (!silent) setLoading(false);
  };

  useEffect(() => { fetchActivities(); }, [selectedStatuses, tagFilter, debouncedSearch, sortBy, sortOrder]);

  const triggerReload = () => { onUpdate(); fetchActivities(true); };

  const toggleStatus = (status: string) => {
    setSelectedStatuses(prev => prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]);
  };

  const handleActivityDeleted = () => {
    setSelectedActivityId(null);
    triggerReload();
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
        <button onClick={() => setShowAddModal(true)} className="bg-primary text-primary-foreground px-4 py-2 rounded hover:bg-primary/90">
          + New Task
        </button>
      </div>

      {isOwner && <p className="text-xs text-muted-foreground">Showing every task (owner view). Employees only see tasks they created or are assigned to.</p>}

      {/* Left-pane list + right-pane detail, same master-detail convention as
          Stock's Accessories/Assets tabs -- list hides on mobile once a task
          is open (drill-in), resizable on desktop. */}
      <div className="flex-1 min-h-[700px] md:min-h-[500px] border rounded overflow-visible md:overflow-hidden flex">
        <div
          className={cn('w-full md:flex-shrink-0 border-r border-border flex flex-col', selectedActivityId && 'hidden md:flex')}
          style={isDesktop ? { width: listPaneWidth } : undefined}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-xs text-muted-foreground">
            <span>Sort:</span>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="border rounded px-1 py-0.5 bg-transparent">
              <option value="due_date">Due Date</option>
              <option value="title">Title</option>
              <option value="priority">Priority</option>
              <option value="status">Status</option>
              <option value="entry_date">Entry Date</option>
            </select>
            <button type="button" onClick={() => setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'))} className="hover:text-foreground inline-flex items-center">
              {sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            </button>
          </div>
          <div className="flex-1 overflow-visible md:overflow-y-auto">
            {activities.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No tasks found.</p>}
            {activities.map(act => (
              <ActivityListRow
                key={act.id}
                activity={act}
                active={act.id === selectedActivityId}
                isOwner={isOwner}
                onOpen={() => setSelectedActivityId(act.id)}
              />
            ))}
          </div>
        </div>

        {isDesktop && (
          <div
            onMouseDown={handlePaneResize}
            className="hidden md:block w-1.5 shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
            title="Drag to resize"
          />
        )}

        <div className={cn('flex-1 min-w-0', !selectedActivityId && 'hidden md:flex md:items-center md:justify-center')}>
          {selectedActivityId ? (
            <ActivityDetailPane
              key={selectedActivityId}
              activityId={selectedActivityId}
              isOwner={isOwner}
              myId={myId}
              tagOptions={tagOptions}
              assignableUsers={assignableUsers}
              onBack={() => setSelectedActivityId(null)}
              onUpdate={triggerReload}
              onDeleted={handleActivityDeleted}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a task to view details.</p>
          )}
        </div>
      </div>

      <AddActivityModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onUpdate={triggerReload} tagOptions={tagOptions} assignableUsers={assignableUsers} />
    </div>
  );
}
