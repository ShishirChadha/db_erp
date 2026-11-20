import { NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/auth/device-sessions'
import { POST as createSalesDocument } from '@/app/api/sales-documents/route'
import { POST as createExpense } from '@/app/api/expenses/route'
import { POST as createSale } from '@/app/api/sales-entry/route'
import { POST as createRepairJob } from '@/app/api/repair-jobs/route'
import { POST as createReplacementJob } from '@/app/api/replacement-jobs/route'

// DB's writes go through the exact route handlers the staff screens use, called
// in-process with DB's own token and device-session cookie. Validation,
// permissions, numbering RPCs, GST maths, stock movements and audit logging are
// therefore identical to a person doing the same thing -- nothing is copied
// here, and a rule added to one of those routes later applies to DB as well.
const ROUTES = {
  sales_document: { path: '/api/sales-documents', handler: createSalesDocument },
  expense: { path: '/api/expenses', handler: createExpense },
  sale: { path: '/api/sales-entry', handler: createSale },
  repair_job: { path: '/api/repair-jobs', handler: createRepairJob },
  replacement_job: { path: '/api/replacement-jobs', handler: createReplacementJob },
} as const

export type RouteKey = keyof typeof ROUTES

export async function callRouteAsDb(
  key: RouteKey,
  body: unknown,
  auth: { token: string; sessionId: string },
): Promise<{ ok: boolean; status: number; data: any }> {
  const { path, handler } = ROUTES[key]
  const req = new NextRequest(new URL(path, 'http://erp.internal'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${auth.token}`,
      cookie: `${SESSION_COOKIE_NAME}=${auth.sessionId}`,
      'user-agent': 'erp-assistant',
    },
    body: JSON.stringify(body),
  })
  const res = await handler(req)
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}
