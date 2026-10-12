'use client'

import { useState } from 'react'
import Link from 'next/link'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not send the reset email')
      }
      setSent(true)
    } catch (err: any) {
      setError(err.message || 'Could not send the reset email')
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div className="mt-6 space-y-3 text-sm text-muted-foreground">
        <p className="rounded-md bg-green-50 px-3 py-2 text-green-800">
          If there is an account for {email}, a reset link is on its way. It can take a few minutes — check your spam folder too.
        </p>
        <Link href="/login" className="text-brand-orange underline">Back to log in</Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <p className="text-sm text-muted-foreground">Enter the email you signed up or ordered with and we&apos;ll send you a link.</p>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div>
        <label htmlFor="fp-email" className="mb-1 block text-xs text-muted-foreground">Email</label>
        <input id="fp-email" required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
      </div>
      <button type="submit" disabled={submitting} className="w-full rounded-full bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
        {submitting ? 'Sending…' : 'Send reset link'}
      </button>
      <p className="text-sm text-muted-foreground"><Link href="/login" className="text-brand-orange underline">Back to log in</Link></p>
    </form>
  )
}
