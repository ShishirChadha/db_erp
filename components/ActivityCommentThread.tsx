'use client';

import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Loader2, Send, Paperclip, Pin, PinOff, X, Smile, FileText } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useAsyncAction } from '@/lib/useAsyncAction';

// Client-safe copy of the palette enforced server-side (lib/activities.ts's
// ALLOWED_REACTIONS) -- kept local, not imported, since that module also
// pulls in the service-role Supabase client and must never reach the browser.
const REACTION_PALETTE = ['👍', '❤️', '🎉', '👀', '🚀', '✅'] as const;

interface Attachment { key: string; name: string; size: number | null }
interface Reaction { emoji: string; count: number; reactedByMe: boolean }

interface Comment {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  mentioned_names: string[];
  attachments: Attachment[];
  pinned: boolean;
  pinned_by_name: string | null;
  reactions: Reaction[];
  edited: boolean;
  created_at: string;
}

interface MentionCandidate { id: string; name: string }

function formatSize(kb: number | null) {
  if (kb === null) return '';
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export default function ActivityCommentThread({
  activityId, mentionPool, myId, isOwner, canPin,
}: {
  activityId: string;
  mentionPool: MentionCandidate[];
  myId: string | null;
  isOwner: boolean;
  canPin: boolean;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [mentioned, setMentioned] = useState<string[]>([]);
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const res = await apiFetch(`/api/activities/${activityId}/comments`);
    if (res.ok) setComments(await res.json());
    setLoading(false);
  };
  useEffect(() => { load(); }, [activityId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { run: submit, pending: submitting } = useAsyncAction(async () => {
    if (!text.trim()) return;
    const res = await apiFetch(`/api/activities/${activityId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: text.trim(), mentioned_user_ids: mentioned, attachments: pendingAttachments }),
    });
    if (res.ok) {
      setText('');
      setMentioned([]);
      setPendingAttachments([]);
      await load();
    } else {
      const b = await res.json().catch(() => ({}));
      alert(b.error || 'Failed to add comment');
    }
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const res = await apiFetch('/api/storage/upload-url', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentType: file.type, folder: `activities/${activityId}/comments`, fileType: 'attachment' }),
      });
      if (!res.ok) throw new Error('Could not get an upload URL');
      const { uploadUrl, key } = await res.json();
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      setPendingAttachments(prev => [...prev, { key, name: file.name, size: Math.round(file.size / 1024) }]);
    } catch {
      alert('File upload failed');
    } finally {
      setUploading(false);
    }
  };

  const openAttachment = async (key: string) => {
    const res = await apiFetch('/api/storage/download-url', { method: 'POST', body: JSON.stringify({ key, expiresIn: 300 }) });
    if (res.ok) window.open((await res.json()).url, '_blank');
  };

  // Detects "@partial-name" being typed at the end of an unbroken word to
  // trigger the mention dropdown -- selecting a candidate inserts the full
  // "@Full Name " text and records the real user id in `mentioned`.
  const handleTextChange = (val: string) => {
    setText(val);
    const atIdx = val.lastIndexOf('@');
    if (atIdx !== -1) {
      const before = val[atIdx - 1];
      const query = val.slice(atIdx + 1);
      if ((atIdx === 0 || /\s/.test(before)) && !/\s/.test(query)) {
        setMentionQuery(query);
        setShowMentionList(true);
        return;
      }
    }
    setShowMentionList(false);
  };

  const pickMention = (c: MentionCandidate) => {
    const atIdx = text.lastIndexOf('@');
    setText(`${text.slice(0, atIdx)}@${c.name} `);
    setMentioned(prev => [...new Set([...prev, c.id])]);
    setShowMentionList(false);
  };

  const filteredCandidates = mentionPool.filter(c => c.name.toLowerCase().includes(mentionQuery.toLowerCase()));

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this comment?')) return;
    await apiFetch(`/api/activities/${activityId}/comments/${id}`, { method: 'DELETE' });
    await load();
  };

  const togglePin = async (c: Comment) => {
    await apiFetch(`/api/activities/${activityId}/comments/${c.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !c.pinned }) });
    await load();
  };

  const toggleReaction = async (commentId: string, emoji: string) => {
    setReactionPickerFor(null);
    await apiFetch(`/api/activities/${activityId}/comments/${commentId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) });
    await load();
  };

  return (
    <div className="space-y-3">
      <h4 className="font-medium text-sm">Comments</h4>
      {loading && <p className="text-xs text-gray-400">Loading...</p>}
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {!loading && comments.length === 0 && <p className="text-xs text-gray-400">No comments yet.</p>}
        {comments.map(c => (
          <div key={c.id} className={`text-sm rounded p-2 ${c.pinned ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
            {c.pinned && (
              <p className="text-[11px] text-amber-700 flex items-center gap-1 mb-1">
                <Pin className="h-3 w-3" /> Pinned by {c.pinned_by_name || 'someone'}
              </p>
            )}
            <div className="flex justify-between items-start">
              <span className="font-medium">{c.author_name}</span>
              <span className="text-xs text-gray-400">
                {format(new Date(c.created_at), 'dd/MM HH:mm')}{c.edited ? ' (edited)' : ''}
              </span>
            </div>
            <p className="whitespace-pre-wrap">{c.body}</p>

            {c.attachments?.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {c.attachments.map((a, i) => (
                  <button key={i} onClick={() => openAttachment(a.key)} className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline">
                    <FileText className="h-3 w-3" /> {a.name} {a.size !== null && <span className="text-gray-400">({formatSize(a.size)})</span>}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {c.reactions.map(r => (
                <button
                  key={r.emoji}
                  onClick={() => toggleReaction(c.id, r.emoji)}
                  className={`text-xs px-1.5 py-0.5 rounded-full border ${r.reactedByMe ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}
                >
                  {r.emoji} {r.count}
                </button>
              ))}
              <div className="relative">
                <button onClick={() => setReactionPickerFor(prev => prev === c.id ? null : c.id)} className="text-gray-400 hover:text-gray-600">
                  <Smile className="h-3.5 w-3.5" />
                </button>
                {reactionPickerFor === c.id && (
                  <div className="absolute bottom-full mb-1 left-0 bg-white border rounded shadow-md flex gap-1 p-1 z-10">
                    {REACTION_PALETTE.map(emoji => (
                      <button key={emoji} onClick={() => toggleReaction(c.id, emoji)} className="hover:bg-gray-100 rounded px-1 text-sm">{emoji}</button>
                    ))}
                  </div>
                )}
              </div>
              {canPin && (
                <button onClick={() => togglePin(c)} className="text-gray-400 hover:text-amber-600 ml-auto" title={c.pinned ? 'Unpin' : 'Pin this comment'}>
                  {c.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                </button>
              )}
              {(c.author_id === myId || isOwner) && (
                <button onClick={() => handleDelete(c.id)} className="text-xs text-red-500 hover:underline">Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pendingAttachments.map((a, i) => (
            <span key={i} className="flex items-center gap-1 text-xs bg-gray-100 rounded px-2 py-1">
              <FileText className="h-3 w-3" /> {a.name}
              <button onClick={() => setPendingAttachments(prev => prev.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="flex gap-2 items-end">
          <textarea
            rows={2}
            className="flex-1 border rounded p-2 text-sm"
            placeholder="Write a comment... use @ to mention someone who can see this task"
            value={text}
            onChange={e => handleTextChange(e.target.value)}
          />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-gray-500 hover:text-gray-700 h-9 px-1 disabled:opacity-50" title="Attach a file">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
          <button onClick={submit} disabled={submitting || !text.trim()} className="px-3 bg-blue-600 text-white rounded disabled:opacity-50 h-9">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        {showMentionList && filteredCandidates.length > 0 && (
          <div className="absolute bottom-full mb-1 left-0 bg-white border rounded shadow-md w-56 max-h-40 overflow-y-auto z-10">
            {filteredCandidates.map(c => (
              <button key={c.id} onClick={() => pickMention(c)} className="block w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100">
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
