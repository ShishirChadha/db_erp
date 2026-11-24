import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { findSharedDocument } from '@/lib/document-share'

// The page a WhatsApp short link opens: the document's name and one button.
// Its title/description become WhatsApp's preview card ("Proforma Invoice
// PI2026/27-00072 · Digitalbluez"). Never indexed.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params
  const doc = await findSharedDocument(code)
  const title = doc.state === 'missing' ? 'Document' : `${doc.title} · Digitalbluez`
  const description = doc.state === 'ok' ? 'Tap to view or download the PDF.' : 'This link has expired. Ask us for a new one.'
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, siteName: 'Digitalbluez', type: 'website' },
  }
}

export default async function SharedDocumentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const doc = await findSharedDocument(code)
  if (doc.state === 'missing') notFound()

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
      <p className="text-sm font-semibold text-brand-orange">Digitalbluez</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">{doc.title}</h1>
      {doc.state === 'ok' ? (
        <>
          <p className="mt-3 text-sm text-muted-foreground">Your document is ready.</p>
          <a
            href={`/d/${doc.code}/pdf`}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-foreground px-6 text-sm font-medium text-background hover:opacity-90"
          >
            View / download PDF
          </a>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          This link has expired. Please message us on WhatsApp and we&apos;ll send a fresh one.
        </p>
      )}
    </main>
  )
}
