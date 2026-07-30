'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserSupabaseClient } from '@db/db/browser'

export default function SignupPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, phone, password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sign up failed')

      const supabase = createBrowserSupabaseClient()
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr) throw signInErr

      router.push('/account')
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-14 sm:px-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Create an account</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Full name</label>
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Email</label>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Phone (optional)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Password</label>
          <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>
        <button type="submit" disabled={submitting} className="w-full rounded-full bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted-foreground">
        Already have an account? <Link href="/login" className="text-brand-orange underline">Log in</Link>
      </p>
    </main>
  )
}
