import RequireOwner from '@/components/RequireOwner'
import GstClient from './gst-client'

export const metadata = { title: 'GST Returns' }

export default function GstReturnsPage() {
  // Page-level gating is UX only -- /api/gst/returns enforces owner-only
  // server-side on every metric.
  return (
    <RequireOwner>
      <GstClient />
    </RequireOwner>
  )
}
