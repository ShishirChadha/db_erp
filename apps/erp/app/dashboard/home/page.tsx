import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getLayoutSessionUser } from '@/lib/auth/session'
import { getMyStaffRow } from '@/lib/attendance-server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getDailyQuote } from '@/lib/daily-quote'
import { PunchWidget } from '@/components/PunchWidget'
import { BusinessUpdatesManager } from '@/components/BusinessUpdatesManager'
import { Megaphone, Quote, IdCard } from 'lucide-react'

// The universal landing page for every signed-in profile -- deliberately the
// ONE page in this app with no RequirePageAccess wrapper and no pageKey at
// all. /dashboard (the KPI overview) stays gated behind the 'dashboard' page
// key because the owner does not want every employee seeing business
// numbers; this page is what a staff member with zero page grants still has
// to land on, so punching, their own identity and whatever the owner wants to
// tell everyone work with no setup. See RequirePageAccess.tsx's fallback.
export default async function HomePage() {
  const sessionUser = await getLayoutSessionUser()
  if (!sessionUser) return null

  const [staff, updatesRes] = await Promise.all([
    getMyStaffRow(sessionUser.userId),
    supabaseAdmin
      .from('business_updates')
      .select('id, message, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const updates = updatesRes.data || []
  const quote = getDailyQuote()

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Punch in/out -- the whole reason this page cannot require a grant.
          Renders nothing for an owner-only login or a staff member not yet
          on the roster (see PunchWidget's own comment). */}
      <PunchWidget />

      {staff && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <IdCard className="h-4 w-4" /> Your details
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{staff.full_name}</span>
            </div>
            {staff.employee_code && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Employee code</span>
                <span className="font-medium tabular-nums">{staff.employee_code}</span>
              </div>
            )}
            {staff.staff_shifts && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shift</span>
                <span className="font-medium">
                  {staff.staff_shifts.name} · {staff.staff_shifts.start_time.slice(0, 5)}-{staff.staff_shifts.end_time.slice(0, 5)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Quote className="h-4 w-4" /> Quote of the day
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm italic text-muted-foreground">&ldquo;{quote}&rdquo;</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Megaphone className="h-4 w-4" /> Business updates
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessionUser.role === 'owner' ? (
            <BusinessUpdatesManager initialUpdates={updates} />
          ) : updates.length > 0 ? (
            <ul className="space-y-1.5">
              {updates.map(u => (
                <li key={u.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  {u.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No updates yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
