'use client'

import { useState } from 'react'

export function NewsletterForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('submitting')
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error()
      setStatus('done')
      setEmail('')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'done') {
    return <p className="text-sm font-medium text-brand-blue-dark">You&apos;re subscribed — thanks!</p>
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-sm gap-2">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        className="w-full rounded-full border border-input bg-background px-4 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25"
      />
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="shrink-0 rounded-full bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === 'submitting' ? '...' : 'Subscribe'}
      </button>
      {status === 'error' && <p className="text-xs text-red-600">Something went wrong.</p>}
    </form>
  )
}
