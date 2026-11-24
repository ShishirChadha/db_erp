import { NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/auth/device-sessions'
import { POST as createSalesDocument } from '@/app/api/sales-documents/route'
import { POST as createExpense } from '@/app/api/expenses/route'
import { POST as createSale } from '@/app/api/sales-entry/route'
import { POST as createRepairJob } from '@/app/api/repair-jobs/route'
import { POST as createReplacementJob } from '@/app/api/replacement-jobs/route'
import { POST as createStockIntake } from '@/app/api/stock-intake/route'
import { POST as createSkuStockMovement } from '@/app/api/sku-master/[id]/stock-movement/route'
import { POST as createTradeIn } from '@/app/api/trade-ins/route'
import { POST as createRma } from '@/app/api/rma/route'

// DB's writes go through the exact route handlers the staff screens use, called
// in-process with DB's own token and device-session cookie. Validation,
// permissions, numbering RPCs, GST maths, stock movements and audit logging are
// therefore identical to a person doing the same thing -- nothing is copied
// here, and a rule added to one of those routes later applies to DB as well.
// Route handlers take (req) or (req, { params }) -- one shape for calling them.
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
const h = (fn: unknown) => fn as Handler

const ROUTES = {
  sales_document: { path: '/api/sales-documents', handler: h(createSalesDocument) },
  expense: { path: '/api/expenses', handler: h(createExpense) },
  sale: { path: '/api/sales-entry', handler: h(createSale) },
  repair_job: { path: '/api/repair-jobs', handler: h(createRepairJob) },
  replacement_job: { path: '/api/replacement-jobs', handler: h(createReplacementJob) },
  // Stock in: the staff-safe New Entry door (one serialized unit per call) and
  // the accessories "Receive stock" door (params.id = the accessory's sku_id).
  stock_intake: { path: '/api/stock-intake', handler: h(createStockIntake) },
  accessory_receipt: { path: '/api/sku-master/[id]/stock-movement', handler: h(createSkuStockMovement) },
  // A customer's old laptop taken as part-payment on a sale (upgrade).
  trade_in: { path: '/api/trade-ins', handler: h(createTradeIn) },
  // A unit we sold coming back from the customer (RMA page, "From Customer").
  customer_return: { path: '/api/rma', handler: h(createRma) },
} as const

export type RouteKey = keyof typeof ROUTES

export async function callRouteAsDb(
  key: RouteKey,
  body: unknown,
  auth: { token: string; sessionId: string },
  params: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const { handler } = ROUTES[key]
  const path = ROUTES[key].path.replace(/\[(\w+)\]/g, (_, k: string) => encodeURIComponent(params[k] ?? ''))
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
  const res = await handler(req, { params: Promise.resolve(params) })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}
