'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveLoginIdentifier } from '@/lib/auth/username'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import Image from 'next/image'
import { useAsyncAction } from '@/lib/useAsyncAction'

export default function LoginPage() {
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

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

    router.push('/dashboard')
    router.refresh()
  })

  return (
    // Outer container – full height, items start from top
    <div className="min-h-screen flex flex-col justify-start bg-gray-50">
      
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
            <h1 className="text-3xl font-semibold text-gray-900">DB Official ERP SYSTEM</h1>
            <p className="text-gray-500 text-sm mt-1">Inventory & Sales Management</p>
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

              {error && (
                <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 py-2.5"
                onClick={handleLogin}
                loading={loading}
              >
                Sign in
              </Button>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-gray-400 mt-6">
            Digitalbluez © {new Date().getFullYear()} · Official Copyright Apply
          </p>
        </div>
      </div>
    </div>
  )
}