'use client'

import { Suspense, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveLoginIdentifier } from '@/lib/auth/username'
import { apiFetch } from '@/lib/api-client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import Image from 'next/image'
import { useAsyncAction } from '@/lib/useAsyncAction'

function LoginForm() {
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const signedOutNotice = searchParams.get('reason') === 'signed_out'

  const { run: handleLogin, pending: loading } = useAsyncAction(async () => {
    setError('')

    // A plain User ID (e.g. "ShishirCH") is transformed to its synthetic login email;
    // an existing account's real email address passes through unchanged -- see
    // lib/auth/username.ts.
    const { error } = await supabase.auth.signInWithPassword({
      email: resolveLoginIdentifier(userId),
      password,
    })

    if (error) {
      setError('Invalid email or password. Please try again.')
      return
    }

    // Awaited (not fire-and-forget) -- this call also registers the device session
    // and sets the session cookie the device-limit/force-logoff feature relies on,
    // so it needs to land before the dashboard's first request.
    await apiFetch('/api/auth/log-event', { method: 'POST', body: JSON.stringify({ event: 'login' }) }).catch(() => {})

    router.push('/dashboard')
    router.refresh()
  })

  return (
    // Outer container – full height, items start from top
    <div className="min-h-screen flex flex-col justify-start bg-background">
      
      {/* Logo at top center – minimal top padding, no bottom margin */}
      <div className="flex justify-center pt-6 pb-0">
        <Image
          src="/DB_LOGO.png"
          alt="Digitalbluez Logo"
          width={400}
          height={80}
          className="object-contain"
        />
      </div>

      {/* Content – no centering, just a small top margin */}
      <div className="px-4 mt-4">  {/* ← reduced top margin (was previously centered with flex-1) */}
        <div className="w-full max-w-xl mx-auto">
          
          {/* Heading – directly after logo with minimal gap */}
          <div className="text-center mb-6">
            <h1 className="text-3xl font-semibold text-foreground">DB Official ERP SYSTEM</h1>
            <p className="text-muted-foreground text-sm mt-1">Inventory & Sales Management</p>
          </div>

          {/* Login card */}
          <Card className="p-15">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl">Sign in to your account</CardTitle>
              <CardDescription>Enter your admin credentials to continue</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="userId">User ID</Label>
                <Input
                  id="userId"
                  type="text"
                  placeholder="Enter User ID"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
              </div>

              {!error && signedOutNotice && (
                <div className="bg-muted text-muted-foreground text-sm px-4 py-3 rounded-lg">
                  You were signed out — please sign in again.
                </div>
              )}

              {error && (
                <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <Button
                className="w-full bg-primary hover:bg-primary/90 py-2.5"
                onClick={handleLogin}
                loading={loading}
              >
                Sign in
              </Button>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Digitalbluez © {new Date().getFullYear()} · Official Copyright Apply
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}