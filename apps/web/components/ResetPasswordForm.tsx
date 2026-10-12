'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { createBrowserSupabaseClient } from '@db/db/browser'

// The emailed recovery link lands here with the session in the URL hash; the
// Supabase browser client reads it on load. If no session shows up shortly,
// the link was already used, expired, or this page was opened directly.
export function ResetPasswordForm() {
  const router = useRouter()
  const [ready, setReady] = useState<'checking' | 'ok' | 'invalid'>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    let cancelled = false
    const { data: sub } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (!cancelled && session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) setReady('ok')
    })
    const timer = setTimeout(async () => {
      const { data } = await supabase.auth.getSession()
      if (!cancelled) setReady(data.session ? 'ok' : 'invalid')
    }, 1500)
    return () => { cancelled = true; clearTimeout(timer); sub.subscription.unsubscribe() }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('The two passwords do not match'); return }
    setSubmitting(true)
    try {
      const supabase = createBrowserSupabaseClient()
      const { error: updateErr } = await supabase.auth.updateUser({ password })
      if (updateErr) throw updateErr
      router.push('/account')
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Could not update your password')
    } finally {
      setSubmitting(false)
    }
  }

  if (ready === 'checking') return <p className="mt-6 text-sm text-muted-foreground">Checking your link…</p>

  if (ready === 'invalid') {
    return (
      <div className="mt-6 space-y-3 text-sm text-muted-foreground">
        <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">This reset link has expired or was already used.</p>
        <Link href="/forgot-password" className="text-brand-orange underline">Request a new link</Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div>
        <label htmlFor="rp-pass" className="mb-1 block text-xs text-muted-foreground">New password (8+ characters)</label>
        <input id="rp-pass" required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
      </div>
      <div>
        <label htmlFor="rp-confirm" className="mb-1 block text-xs text-muted-foreground">Confirm new password</label>
        <input id="rp-confirm" required minLength={8} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
      </div>
      <button type="submit" disabled={submitting} className="w-full rounded-full bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
        {submitting ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  )
}
