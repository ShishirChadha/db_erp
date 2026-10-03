'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

export interface MyAttendanceShift {
  id: string
  name: string
  start_time: string
  end_time: string
}

export interface MyAttendanceDay {
  id: string
  work_date: string
  status: string
  status_source: string
  first_in_at: string | null
  last_out_at: string | null
  worked_minutes: number
  late_minutes: number
  is_late: boolean
  punch_pair_count?: number
  overtime_minutes?: number
}

export interface MyAttendance {
  staff: { id: string; full_name: string; employee_code: string | null; shift: MyAttendanceShift | null } | null
  today?: MyAttendanceDay | null
  open_punch?: { id: string; punched_at: string; work_date: string } | null
  recent?: MyAttendanceDay[]
}

// Module-level cache shared by every mounted PunchWidget, so the widget in the
// mobile top bar and the one on the dashboard do not each fetch. Same idiom as
// useCustomOptions/useListPageSize. Short TTL because the punch state changes
// the moment the user taps -- and refresh() busts it outright after a punch.
let cache: MyAttendance | null = null
let cacheAt = 0
let inFlight: Promise<MyAttendance | null> | null = null
const TTL_MS = 30_000

const subscribers = new Set<(v: MyAttendance | null) => void>()

function publish(v: MyAttendance | null) {
  cache = v
  cacheAt = Date.now()
  subscribers.forEach(fn => fn(v))
}

async function load(force: boolean): Promise<MyAttendance | null> {
  if (!force && cache && Date.now() - cacheAt < TTL_MS) return cache
  if (!force && inFlight) return inFlight
  inFlight = (async () => {
    try {
      const res = await apiFetch('/api/attendance/me')
      if (!res.ok) return null
      const json: MyAttendance = await res.json()
      publish(json)
      return json
    } catch {
      return null
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

export function useMyAttendance() {
  const [data, setData] = useState<MyAttendance | null>(cache)
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    subscribers.add(setData)
    let alive = true
    load(false).then(() => { if (alive) setLoading(false) })
    return () => { alive = false; subscribers.delete(setData) }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    await load(true)
    setLoading(false)
  }, [])

  // Lets the punch route's own response update every widget without a refetch.
  const applyPunchResult = useCallback((day: MyAttendanceDay | null, openPunch: MyAttendance['open_punch']) => {
    if (!cache) return
    publish({ ...cache, today: day, open_punch: openPunch })
  }, [])

  return { data, loading, refresh, applyPunchResult }
}
