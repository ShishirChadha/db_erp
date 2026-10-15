'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { downscaleImageFile } from '@/lib/client-image'
import { Checkbox } from '@/components/ui/checkbox'
import { ListItem, Panes } from '@/components/MasterDetail'

// Settings -> Website Admin -> Company & About. Everything the public website
// shows about the company (contact details, hours, address, legal contacts, the
// About page, founder, team, photos) lives in ONE row, so it can be changed
// here without a developer. Each group saves on its own.

const inputCls = 'border p-2 rounded w-full text-sm bg-background'
const btnPrimary = 'bg-primary text-primary-foreground px-4 py-2 rounded text-sm disabled:opacity-50'
const btnGhost = 'border px-3 py-2 rounded text-sm hover:bg-muted disabled:opacity-50'
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const photoUrl = (path: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${path}`
const errorOf = (res: Response, fallback: string) => res.json().then((j) => j.error || fallback).catch(() => fallback)

type Profile = Record<string, any>
interface TeamMember { id?: string; name: string; role: string | null; bio: string | null; photo_path: string | null; sort_order: number; is_active: boolean }

const GROUPS = [
  { key: 'contact', label: 'Contact & hours', hint: 'Phone, WhatsApp, email, opening hours' },
  { key: 'address', label: 'Address & map', hint: 'Shown in footer, contact page and Google markup' },
  { key: 'google', label: 'Google & social', hint: 'Profile link, rating, social pages' },
  { key: 'legal', label: 'Legal contacts', hint: 'Grievance officer, privacy contact, court, dates' },
  { key: 'about', label: 'About page text', hint: 'Story, mission, services, how we test' },
  { key: 'founder', label: 'Founder', hint: 'Name, role, bio, photo' },
  { key: 'photos', label: 'Store photos', hint: 'Real photos of the store and team' },
  { key: 'team', label: 'Team', hint: 'People shown on the About page' },
] as const
type GroupKey = typeof GROUPS[number]['key']

// Which profile columns each group edits (and therefore sends when saving).
const GROUP_FIELDS: Record<Exclude<GroupKey, 'team'>, string[]> = {
  contact: ['phone_display', 'phone_tel', 'whatsapp_number', 'email', 'hours_text', 'opens', 'closes', 'open_days'],
  address: ['street_address', 'address_locality', 'address_region', 'postal_code', 'address_country', 'address_lines', 'area_note', 'maps_query'],
  google: ['google_profile_url', 'google_rating', 'google_review_count', 'google_rating_as_of', 'instagram_url', 'facebook_url', 'linkedin_url'],
  legal: ['grievance_officer_name', 'grievance_officer_email', 'data_protection_name', 'data_protection_email', 'legal_jurisdiction', 'retention_text', 'privacy_updated_on', 'terms_updated_on'],
  about: ['year_started', 'about_story_md', 'mission_md', 'services_md', 'testing_note_md'],
  founder: ['founder_name', 'founder_role', 'founder_bio_md', 'founder_photo_path'],
  photos: ['store_photos'],
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">
        {label} {hint && <span className="text-muted-foreground">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

function PhotoUpload({ value, onChange, fileType }: { value: string | null; onChange: (path: string | null) => void; fileType: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const upload = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      // Same path as the banner/product uploaders: shrunk in the browser, then resized
      // and re-encoded to webp on the server before it reaches storage.
      const form = new FormData()
      form.append('file', await downscaleImageFile(file))
      form.append('folder', 'site/profile')
      form.append('fileType', fileType)
      const res = await apiFetch('/api/storage/upload-image', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await errorOf(res, 'Upload failed'))
      onChange((await res.json()).key)
    } catch (e: any) {
      setError(e.message || 'Upload failed')
    }
    setBusy(false)
  }

  return (
    <div className="flex items-start gap-3">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl(value)} alt="" className="h-20 w-20 rounded-lg bg-muted object-cover" />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">No photo</div>
      )}
      <div className="space-y-1">
        <input type="file" accept="image/*" disabled={busy} className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        {busy && <div className="text-xs text-muted-foreground">Uploading…</div>}
        {value && !busy && <button type="button" className="block text-xs text-destructive" onClick={() => onChange(null)}>Remove photo</button>}
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
    </div>
  )
}

export default function SiteProfileSection() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [business, setBusiness] = useState<{ legal_name: string; gstin: string } | null>(null)
  const [group, setGroup] = useState<GroupKey>('contact')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [member, setMember] = useState<TeamMember | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/website-admin/site-profile')
    if (res.ok) {
      const d = await res.json()
      setProfile(d.profile)
      setTeam(d.team)
      setBusiness(d.business)
    } else {
      setError(await errorOf(res, 'Failed to load'))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (k: string, v: unknown) => setProfile((p) => (p ? { ...p, [k]: v } : p))
  const val = (k: string) => (profile?.[k] ?? '') as string

  const saveGroup = async () => {
    if (!profile || group === 'team') return
    setSaving(true); setError(''); setMessage('')
    const body: Record<string, unknown> = {}
    for (const k of GROUP_FIELDS[group]) body[k] = profile[k] === '' ? null : profile[k]
    const res = await apiFetch('/api/website-admin/site-profile', { method: 'PATCH', body: JSON.stringify(body) })
    if (res.ok) { setMessage('Saved. The website updates within a minute.'); await load() }
    else setError(await errorOf(res, 'Failed to save'))
    setSaving(false)
  }

  const saveMember = async () => {
    if (!member) return
    setSaving(true); setError(''); setMessage('')
    const res = await apiFetch('/api/website-admin/site-profile/team', { method: 'PUT', body: JSON.stringify(member) })
    if (res.ok) { setMember(null); setMessage('Saved.'); await load() } else setError(await errorOf(res, 'Failed to save'))
    setSaving(false)
  }

  const removeMember = async (m: TeamMember) => {
    if (!confirm(`Remove ${m.name} from the About page?`)) return
    await apiFetch(`/api/website-admin/site-profile/team?id=${m.id}`, { method: 'DELETE' })
    setMember(null)
    await load()
  }

  if (!profile) return <div className="text-sm text-muted-foreground">{error || 'Loading…'}</div>

  const text = (k: string, label: string, opts: { hint?: string; type?: string; placeholder?: string } = {}) => (
    <Field label={label} hint={opts.hint}>
      <input className={inputCls} type={opts.type ?? 'text'} value={val(k)} placeholder={opts.placeholder} onChange={(e) => set(k, e.target.value)} />
    </Field>
  )
  const area = (k: string, label: string, rows = 4, hint?: string) => (
    <Field label={label} hint={hint}>
      <textarea className={inputCls} rows={rows} value={val(k)} onChange={(e) => set(k, e.target.value)} />
    </Field>
  )

  const photos: { path: string; alt: string; caption?: string }[] = profile.store_photos ?? []
  const setPhoto = (i: number, patch: Partial<{ path: string; alt: string; caption: string }>) =>
    set('store_photos', photos.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  return (
    <Panes
      bp="xl"
      open={open}
      onBack={() => setOpen(false)}
      backLabel="Back to company settings"
      list={
        <div className="space-y-1">
          {GROUPS.map((g) => (
            <ListItem key={g.key} selected={group === g.key} onClick={() => { setGroup(g.key); setOpen(true); setMessage(''); setError(''); setMember(null) }} title={g.label} sub={g.hint} />
          ))}
        </div>
      }
    >
      <div className="max-w-xl space-y-4">
        <h4 className="text-sm font-semibold">{GROUPS.find((g) => g.key === group)?.label}</h4>

        {group === 'contact' && (
          <>
            {text('phone_display', 'Phone, as shown', { placeholder: '+91 99911 11193' })}
            {text('phone_tel', 'Phone, for tap-to-call', { hint: 'digits with country code', placeholder: '+919991111193' })}
            {text('whatsapp_number', 'WhatsApp number', { hint: 'digits only', placeholder: '919991111193' })}
            {text('email', 'Public email', { type: 'email' })}
            {text('hours_text', 'Opening hours, as shown', { placeholder: 'Every day, 9:00 AM – 8:00 PM' })}
            <div className="grid grid-cols-2 gap-3">
              {text('opens', 'Opens', { hint: '24-hour', placeholder: '09:00' })}
              {text('closes', 'Closes', { hint: '24-hour', placeholder: '20:00' })}
            </div>
            <Field label="Open on" hint="used in Google's business markup">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {DAYS.map((d) => (
                  <label key={d} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={(profile.open_days ?? []).includes(d)}
                      onCheckedChange={(c) => set('open_days', c === true ? [...(profile.open_days ?? []), d] : (profile.open_days ?? []).filter((x: string) => x !== d))}
                    />
                    {d.slice(0, 3)}
                  </label>
                ))}
              </div>
            </Field>
          </>
        )}

        {group === 'address' && (
          <>
            <Field label="Address lines" hint="one per line, as shown in the footer">
              <textarea
                className={inputCls}
                rows={4}
                value={(profile.address_lines ?? []).join('\n')}
                onChange={(e) => set('address_lines', e.target.value.split('\n'))}
              />
            </Field>
            {text('street_address', 'Street address', { hint: 'one line, for Google markup' })}
            <div className="grid grid-cols-2 gap-3">
              {text('address_locality', 'City')}
              {text('address_region', 'State')}
              {text('postal_code', 'Postal code')}
              {text('address_country', 'Country code', { placeholder: 'IN' })}
            </div>
            {text('area_note', 'Local area name', { hint: 'e.g. Greater Noida West' })}
            {text('maps_query', 'Map search text', { hint: 'what the map on the contact page looks up' })}
            <p className="text-xs text-muted-foreground">Keep this identical to your Google Business Profile address, and to your GST registration for invoices.</p>
          </>
        )}

        {group === 'google' && (
          <>
            {text('google_profile_url', 'Google Business Profile link', { placeholder: 'https://…' })}
            <div className="grid grid-cols-3 gap-3">
              {text('google_rating', 'Rating', { type: 'number', placeholder: '4.9' })}
              {text('google_review_count', 'Reviews', { type: 'number' })}
              {text('google_rating_as_of', 'As of', { type: 'date' })}
            </div>
            <p className="text-xs text-muted-foreground">Copy these from your Google profile and update the date when you do. Never enter a rating you can&apos;t see there.</p>
            {text('instagram_url', 'Instagram')}
            {text('facebook_url', 'Facebook')}
            {text('linkedin_url', 'LinkedIn company page')}
          </>
        )}

        {group === 'legal' && (
          <>
            {business && (
              <p className="rounded border bg-muted/40 p-2 text-xs text-muted-foreground">
                Company name and GSTIN come from Business Profiles: <b>{business.legal_name}</b>, GSTIN {business.gstin}.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {text('grievance_officer_name', 'Grievance Officer (orders)')}
              {text('grievance_officer_email', 'Their email', { type: 'email' })}
              {text('data_protection_name', 'Privacy contact')}
              {text('data_protection_email', 'Their email', { type: 'email' })}
            </div>
            {text('legal_jurisdiction', 'Court jurisdiction', { hint: 'Terms, section 11' })}
            {area('retention_text', 'How long records are kept', 3, 'Privacy policy, section 5')}
            <div className="grid grid-cols-2 gap-3">
              {text('privacy_updated_on', 'Privacy policy date', { type: 'date' })}
              {text('terms_updated_on', 'Terms date', { type: 'date' })}
            </div>
            <p className="text-xs text-muted-foreground">Have your CA check wording changes here, especially the record-keeping period.</p>
          </>
        )}

        {group === 'about' && (
          <>
            {text('year_started', 'Year started', { type: 'number', placeholder: '2021' })}
            {area('about_story_md', 'Who we are and what we sell', 5, 'Markdown')}
            {area('mission_md', 'Mission', 3, 'Markdown')}
            {area('services_md', 'What we do (services)', 3, 'Markdown — only list services you offer to the public')}
            {area('testing_note_md', 'How every laptop is checked', 4, 'Markdown — only checks you really perform')}
          </>
        )}

        {group === 'founder' && (
          <>
            {text('founder_name', 'Name')}
            {text('founder_role', 'Role', { placeholder: 'Founder' })}
            {area('founder_bio_md', 'Short bio', 4, 'Markdown')}
            <Field label="Photo">
              <PhotoUpload value={profile.founder_photo_path ?? null} onChange={(p) => set('founder_photo_path', p)} fileType="founder" />
            </Field>
          </>
        )}

        {group === 'photos' && (
          <>
            <p className="text-sm text-muted-foreground">Real photos only — the storefront, the testing bench, the team. Each needs a short description for visitors who can&apos;t see it.</p>
            {photos.map((p, i) => (
              <div key={p.path} className="space-y-2 rounded-lg border p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(p.path)} alt="" className="h-28 w-full rounded bg-muted object-cover" />
                <input className={inputCls} placeholder="Describe the photo (required)" value={p.alt} onChange={(e) => setPhoto(i, { alt: e.target.value })} />
                <input className={inputCls} placeholder="Caption (optional)" value={p.caption ?? ''} onChange={(e) => setPhoto(i, { caption: e.target.value })} />
                <button type="button" className="text-xs text-destructive" onClick={() => set('store_photos', photos.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            {photos.length < 12 && (
              <PhotoUpload value={null} fileType="store" onChange={(path) => path && set('store_photos', [...photos, { path, alt: '' }])} />
            )}
          </>
        )}

        {group === 'team' && (
          <>
            {team.length === 0 && !member && <p className="text-sm text-muted-foreground">No team members yet.</p>}
            {!member && (
              <div className="space-y-2">
                {team.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{m.name}{!m.is_active && <span className="ml-2 text-xs text-muted-foreground">(hidden)</span>}</div>
                      <div className="text-xs text-muted-foreground">{m.role ?? 'No role'}</div>
                    </div>
                    <div className="shrink-0 space-x-3">
                      <button className="text-primary" onClick={() => setMember(m)}>Edit</button>
                      <button className="text-destructive" onClick={() => removeMember(m)}>Remove</button>
                    </div>
                  </div>
                ))}
                <button className={btnGhost} onClick={() => setMember({ name: '', role: '', bio: '', photo_path: null, sort_order: team.length, is_active: true })}>+ Add a team member</button>
              </div>
            )}
            {member && (
              <div className="space-y-3 rounded-lg border p-4">
                <Field label="Name"><input className={inputCls} value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} /></Field>
                <Field label="Role"><input className={inputCls} value={member.role ?? ''} onChange={(e) => setMember({ ...member, role: e.target.value })} /></Field>
                <Field label="One line about them" hint="max 400 characters">
                  <textarea className={inputCls} rows={3} value={member.bio ?? ''} onChange={(e) => setMember({ ...member, bio: e.target.value })} />
                </Field>
                <Field label="Photo"><PhotoUpload value={member.photo_path} fileType="team" onChange={(p) => setMember({ ...member, photo_path: p })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Order"><input className={inputCls} type="number" min={0} value={member.sort_order} onChange={(e) => setMember({ ...member, sort_order: Number(e.target.value) })} /></Field>
                  <label className="mt-5 flex items-center gap-2 text-sm">
                    <Checkbox checked={member.is_active} onCheckedChange={(c) => setMember({ ...member, is_active: c === true })} /> Show on About page
                  </label>
                </div>
                <div className="flex gap-2">
                  <button className={btnPrimary} onClick={saveMember} disabled={saving || !member.name.trim()}>Save</button>
                  <button className={btnGhost} onClick={() => setMember(null)}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}

        {error && <div className="text-sm text-destructive">{error}</div>}
        {message && <div className="text-sm text-green-700">{message}</div>}
        {group !== 'team' && (
          <button className={btnPrimary} onClick={saveGroup} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        )}
      </div>
    </Panes>
  )
}
