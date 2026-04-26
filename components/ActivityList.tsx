'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Edit, Trash2, Copy, X, ArrowUp, ArrowDown } from 'lucide-react';

function getTagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 85%)`;
}

function SimpleModal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
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

// ----------------------------------------------
// Add Activity Modal (with tag suggestions)
// ----------------------------------------------
function AddActivityModal({ isOpen, onClose, onUpdate, existingTags }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    tags: [],
    status: 'pending',
    due_date: '',
    reminder_at: '',
  });
  const [tagInput, setTagInput] = useState('');

  const handleAddTag = () => {
    const newTag = tagInput.trim();
    if (newTag && !form.tags.includes(newTag)) {
      setForm(prev => ({ ...prev, tags: [...prev.tags, newTag] }));
      setTagInput('');
    }
  };

  const removeTag = (tag) => {
    setForm(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  };

  const handleSubmit = async () => {
    if (!form.title) return alert('Title is required');
    const res = await fetch('/api/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      onUpdate();
      onClose();
      setForm({ title: '', description: '', tags: [], status: 'pending', due_date: '', reminder_at: '' });
    } else {
      alert('Failed to add activity');
    }
  };

  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="New Activity">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium">Title *</label>
          <input type="text" className="w-full border rounded p-2" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium">Description</label>
          <textarea rows={3} className="w-full border rounded p-2" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium">Tags</label>
          <div className="flex gap-2">
            <input
              list="tag-suggestions"
              className="border rounded p-2 flex-1"
              placeholder="Select or type new tag"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
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
        <div>
          <label className="block text-sm font-medium">Status</label>
          <select className="w-full border rounded p-2" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Due Date</label>
          <input type="datetime-local" className="w-full border rounded p-2" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium">Reminder</label>
          <input type="datetime-local" className="w-full border rounded p-2" value={form.reminder_at} onChange={e => setForm({ ...form, reminder_at: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
        </div>
      </div>
    </SimpleModal>
  );
}

// ----------------------------------------------
// Edit Activity Modal (with tag suggestions)
// ----------------------------------------------
function EditActivityModal({ activity, isOpen, onClose, onUpdate, existingTags }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    tags: [],
    status: 'pending',
    due_date: '',
    reminder_at: '',
  });
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (activity) {
      setForm({
        title: activity.title || '',
        description: activity.description || '',
        tags: activity.tags || [],
        status: activity.status || 'pending',
        due_date: activity.due_date ? activity.due_date.slice(0, 16) : '',
        reminder_at: activity.reminder_at ? activity.reminder_at.slice(0, 16) : '',
      });
    }
  }, [activity]);

  const handleAddTag = () => {
    const newTag = tagInput.trim();
    if (newTag && !form.tags.includes(newTag)) {
      setForm(prev => ({ ...prev, tags: [...prev.tags, newTag] }));
      setTagInput('');
    }
  };

  const removeTag = (tag) => {
    setForm(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  };

  const handleSubmit = async () => {
    if (!form.title) return alert('Title is required');
    const res = await fetch(`/api/activities/${activity.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      onUpdate();
      onClose();
    } else {
      alert('Failed to update');
    }
  };

  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="Edit Activity">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium">Title *</label>
          <input type="text" className="w-full border rounded p-2" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium">Description</label>
          <textarea rows={3} className="w-full border rounded p-2" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium">Tags</label>
          <div className="flex gap-2">
            <input
              list="tag-suggestions"
              className="border rounded p-2 flex-1"
              placeholder="Select or type new tag"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
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
        <div>
          <label className="block text-sm font-medium">Status</label>
          <select className="w-full border rounded p-2" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Due Date</label>
          <input type="datetime-local" className="w-full border rounded p-2" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
        </div>
        <div>
          <label className="block text-sm font-medium">Reminder</label>
          <input type="datetime-local" className="w-full border rounded p-2" value={form.reminder_at} onChange={e => setForm({ ...form, reminder_at: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded">Update</button>
        </div>
      </div>
    </SimpleModal>
  );
}

// --------------------------------------------------
// Delete Confirm Modal (unchanged)
// --------------------------------------------------
function DeleteConfirmModal({ isOpen, onClose, onConfirm }) {
  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="Delete Activity">
      <p>Are you sure you want to delete this activity?</p>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
        <button onClick={onConfirm} className="px-4 py-2 bg-red-600 text-white rounded">Delete</button>
      </div>
    </SimpleModal>
  );
}

// --------------------------------------------------
// Detail Modal (unchanged)
// --------------------------------------------------
function DetailModal({ activity, isOpen, onClose }) {
  if (!activity) return null;
  return (
    <SimpleModal isOpen={isOpen} onClose={onClose} title="Activity Details">
      <div className="space-y-2">
        <p><strong>Description:</strong> {activity.description || '—'}</p>
        <p><strong>Tags:</strong> {activity.tags?.join(', ') || '—'}</p>
        <p><strong>Status:</strong> {activity.status}</p>
        <p><strong>Due Date:</strong> {activity.due_date ? format(new Date(activity.due_date), 'dd/MM/yyyy HH:mm') : '—'}</p>
        <p><strong>Reminder:</strong> {activity.reminder_at ? format(new Date(activity.reminder_at), 'dd/MM/yyyy HH:mm') : '—'}</p>
        <p><strong>Entry Date:</strong> {activity.created_at ? format(new Date(activity.created_at), 'dd/MM/yyyy HH:mm') : '—'}</p>
        <p><strong>Last Updated:</strong> {activity.updated_at ? format(new Date(activity.updated_at), 'dd/MM/yyyy HH:mm') : '—'}</p>
      </div>
    </SimpleModal>
  );
}

// --------------------------------------------------
// Main ActivityList Component
// --------------------------------------------------
export default function ActivityList({ onUpdate }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatuses, setSelectedStatuses] = useState(['pending', 'in_progress', 'done']);
  const [tagFilter, setTagFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [sortBy, setSortBy] = useState('entry_date');
  const [sortOrder, setSortOrder] = useState('desc');
  const [existingTags, setExistingTags] = useState([]);

  // Fetch existing tags for suggestions
  useEffect(() => {
    const fetchTags = async () => {
      const res = await fetch('/api/tags');
      if (res.ok) {
        const tags = await res.json();
        setExistingTags(tags);
      }
    };
    fetchTags();
  }, []);

  // Fetch activities with sorting & filters
  useEffect(() => {
    const fetchActivities = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedStatuses.length > 0 && selectedStatuses.length < 3) {
        params.append('status', selectedStatuses.join(','));
      }
      if (tagFilter) params.append('tag', tagFilter);
      if (search) params.append('search', search);
      params.append('sort_by', sortBy);
      params.append('sort_order', sortOrder);
      const res = await fetch(`/api/activities?${params.toString()}`);
      const data = await res.json();
      if (res.ok) setActivities(data);
      setLoading(false);
    };
    fetchActivities();
  }, [selectedStatuses, tagFilter, search, sortBy, sortOrder]);

  const toggleStatus = (status) => {
    setSelectedStatuses(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const handleDelete = async () => {
    await fetch(`/api/activities/${deleteId}`, { method: 'DELETE' });
    onUpdate();
    setDeleteId(null);
  };

  const handleDuplicate = async (act) => {
    const { id, ...rest } = act;
    await fetch('/api/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rest, title: `${act.title} (copy)`, status: 'pending' }),
    });
    onUpdate();
  };

  const SortIcon = ({ column }) => {
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
              {['pending', 'in_progress', 'done'].map(status => (
                <label key={status} className="flex items-center gap-1">
                  <input type="checkbox" checked={selectedStatuses.includes(status)} onChange={() => toggleStatus(status)} className="rounded" />
                  <span className="capitalize">{status.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <button onClick={() => setShowAddModal(true)} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          + New Activity
        </button>
      </div>

      <div className="border rounded overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('title')}>
                Title <SortIcon column="title" />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('tags')}>
                Tags <SortIcon column="tags" />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('status')}>
                Status <SortIcon column="status" />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('due_date')}>
                Due Date <SortIcon column="due_date" />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('reminder_at')}>
                Reminder <SortIcon column="reminder_at" />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100" onClick={() => handleSort('entry_date')}>
                Entry Date <SortIcon column="entry_date" />
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {activities.map((act) => (
              <tr key={act.id} className={act.status === 'done' ? 'opacity-50' : ''}>
                <td className="px-6 py-4">
                  <button onClick={() => setSelectedActivity(act)} className="text-blue-600 hover:underline text-left">
                    {act.title}
                  </button>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {act.tags?.map((tag) => (
                      <span key={tag} style={{ backgroundColor: getTagColor(tag) }} className="px-2 py-1 rounded text-xs">{tag}</span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 capitalize">{act.status}</td>
                <td className="px-6 py-4">{act.due_date ? format(new Date(act.due_date), 'dd/MM/yyyy') : '-'}</td>
                <td className="px-6 py-4">{act.reminder_at ? format(new Date(act.reminder_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                <td className="px-6 py-4">{act.created_at ? format(new Date(act.created_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                <td className="px-6 py-4 text-right space-x-2">
                  <button onClick={() => setEditingActivity(act)} className="text-gray-600 hover:text-blue-600"><Edit className="h-4 w-4 inline" /></button>
                  <button onClick={() => handleDuplicate(act)} className="text-gray-600 hover:text-green-600"><Copy className="h-4 w-4 inline" /></button>
                  <button onClick={() => setDeleteId(act.id)} className="text-gray-600 hover:text-red-600"><Trash2 className="h-4 w-4 inline" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <AddActivityModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onUpdate={onUpdate} existingTags={existingTags} />
      <EditActivityModal activity={editingActivity} isOpen={!!editingActivity} onClose={() => setEditingActivity(null)} onUpdate={onUpdate} existingTags={existingTags} />
      <DetailModal activity={selectedActivity} isOpen={!!selectedActivity} onClose={() => setSelectedActivity(null)} />
      <DeleteConfirmModal isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} />
    </div>
  );
}