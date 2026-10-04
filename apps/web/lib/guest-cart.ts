'use client'

import { sortSelectedUpgrades, type SelectedUpgrade } from '@/lib/upgrades'

// Cart for visitors who are not signed in.
//
// WHY localStorage and not a table or an anonymous auth session:
//
//   - An anonymous Supabase session is actively harmful against this schema.
//     cart_items.customer_id has an FK to customer_profiles(id), which in turn
//     needs a `customers` row -- so every anonymous visitor would create CRM
//     records, polluting the customer list and destroying the "new website
//     signups" metric outright. Plus a real auth user per bot visit.
//   - A server-side guest_carts table keyed by a cookie would survive device
//     changes, but it means a new table, a new RLS surface, a prune job, and
//     the storefront's first unauthenticated write path. Not justified for a
//     60-product shop.
//   - localStorage costs nothing and loses nothing that matters: a guest
//     cart's value is the next few minutes, and the *intent* is already
//     captured permanently by the GA4 add_to_cart event regardless of whether
//     the cart itself survives.
//
// Everything here treats the stored blob as HOSTILE INPUT -- it is user-
// writable by definition. Every read validates and drops anything malformed,
// and /api/cart/merge re-validates server-side rather than trusting any of it.

const KEY = 'db_guest_cart_v1'
const MAX_LINES = 20
const MAX_QTY_PER_LINE = 10
const MAX_TOTAL_UNITS = 50
const PRUNE_AFTER_DAYS = 30

export interface GuestLine {
  sku_id: string
  quantity: number
  selected_upgrades: SelectedUpgrade[]
  added_at: string
}

export const GUEST_CART_LIMITS = { MAX_LINES, MAX_QTY_PER_LINE, MAX_TOTAL_UNITS }

function isUuidish(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f-]{32,36}$/i.test(v)
}

function sameLine(a: GuestLine, skuId: string, upgrades: SelectedUpgrade[]): boolean {
  // Compared as sorted JSON because the database's UNIQUE constraint is on
  // (customer_id, sku_id, selected_upgrades) and compares jsonb -- so
  // [{a},{b}] and [{b},{a}] are DIFFERENT values there. Normalising on both
  // sides is what stops the merge creating a duplicate line.
  return a.sku_id === skuId &&
    JSON.stringify(sortSelectedUpgrades(a.selected_upgrades)) === JSON.stringify(sortSelectedUpgrades(upgrades))
}

export function readGuestCart(): GuestLine[] {
  if (typeof window === 'undefined') return []
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return [] // private mode / blocked storage
  }
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const cutoff = Date.now() - PRUNE_AFTER_DAYS * 86_400_000
  const clean: GuestLine[] = []
  for (const line of parsed) {
    if (!line || typeof line !== 'object') continue
    const l = line as Record<string, unknown>
    if (!isUuidish(l.sku_id)) continue
    const qty = Number(l.quantity)
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) continue
    const addedAt = typeof l.added_at === 'string' ? l.added_at : new Date().toISOString()
    if (new Date(addedAt).getTime() < cutoff) continue
    clean.push({
      sku_id: l.sku_id,
      quantity: qty,
      selected_upgrades: Array.isArray(l.selected_upgrades)
        ? sortSelectedUpgrades(l.selected_upgrades as SelectedUpgrade[])
        : [],
      added_at: addedAt,
    })
    if (clean.length >= MAX_LINES) break
  }
  return clean
}

function write(lines: GuestLine[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines))
    // Lets the header badge update without a navigation. 'storage' only fires
    // in OTHER tabs, so same-tab listeners need their own event.
    window.dispatchEvent(new Event('db-guest-cart-changed'))
  } catch {
    // Out of quota or blocked -- nothing useful to do, and the customer must
    // not see an error for this.
  }
}

export type AddResult = 'added' | 'cart_full' | 'line_full'

export function addToGuestCart(
  skuId: string,
  upgrades: SelectedUpgrade[] = [],
  quantity = 1,
): AddResult {
  const lines = readGuestCart()
  const sorted = sortSelectedUpgrades(upgrades)
  const existing = lines.find((l) => sameLine(l, skuId, sorted))

  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0)
  if (totalUnits + quantity > MAX_TOTAL_UNITS) return 'cart_full'

  if (existing) {
    if (existing.quantity + quantity > MAX_QTY_PER_LINE) return 'line_full'
    existing.quantity += quantity
  } else {
    if (lines.length >= MAX_LINES) return 'cart_full'
    lines.push({ sku_id: skuId, quantity, selected_upgrades: sorted, added_at: new Date().toISOString() })
  }
  write(lines)
  return 'added'
}

export function setGuestLineQuantity(skuId: string, upgrades: SelectedUpgrade[], next: number): void {
  const lines = readGuestCart()
  const sorted = sortSelectedUpgrades(upgrades)
  const idx = lines.findIndex((l) => sameLine(l, skuId, sorted))
  if (idx === -1) return
  if (next <= 0) lines.splice(idx, 1)
  else lines[idx].quantity = Math.min(next, MAX_QTY_PER_LINE)
  write(lines)
}

export function clearGuestCart(): void {
  try {
    localStorage.removeItem(KEY)
    window.dispatchEvent(new Event('db-guest-cart-changed'))
  } catch {
    /* ignore */
  }
}

export function guestCartCount(): number {
  return readGuestCart().reduce((sum, l) => sum + l.quantity, 0)
}

export interface MergeResult {
  merged: number
  dropped: string[]
}

// Called once on the login/signup transition, from LoginForm and SignupForm.
//
// Deliberately NOT wired to onAuthStateChange: that fires on every token
// refresh in every open tab, which would re-merge repeatedly.
//
// localStorage is cleared only after a 2xx, and the fetch is awaited before any
// navigation -- that ordering is what keeps a double-merge from happening in
// practice. A genuine double-fire would sum a quantity to 2 instead of 1,
// capped at 10: a visible, customer-correctable annoyance, not corruption,
// which is why there is no idempotency-token table for it.
export async function mergeGuestCartIfAny(): Promise<MergeResult | null> {
  const lines = readGuestCart()
  if (lines.length === 0) return null
  try {
    const res = await fetch('/api/cart/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines }),
    })
    if (!res.ok) return null
    const result: MergeResult = await res.json()
    clearGuestCart()
    return result
  } catch {
    return null
  }
}
