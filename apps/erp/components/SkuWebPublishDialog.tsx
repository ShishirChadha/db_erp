'use client'

import { useEffect, useState } from 'react'
import { Loader2, Star, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import { SimpleModal } from '@/components/SimpleModal'
import { buildConfigSummary } from '@/lib/sku-config-summary'

const CONDITION_GRADES = ['Excellent', 'Very Good', 'Good', 'Fair']

interface ProductImage {
  id: string
  storage_path: string
  is_primary: boolean
  alt_text: string | null
}

interface SkuLike {
  id: string
  full_sku_code: string
  category: string
  brand: string
  model_name: string
  specifications: any
  selling_price_default: number | null
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function publicImageUrl(storagePath: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${storagePath}`
}

// Owner-only: publish/unpublish a SKU to the DigitalBluez website, edit its
// public-facing price/copy, and manage its photos. Deliberately a separate
// dialog from SkuFormModal -- these fields are marketing/website concerns, not
// core catalog data, and would clutter the specs/cost editor.
export function SkuWebPublishDialog({
  sku,
  templates,
  onClose,
  onSaved,
}: {
  sku: SkuLike
  templates: any[]
  onClose: () => void
  onSaved: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [images, setImages] = useState<ProductImage[]>([])

  const [isPublished, setIsPublished] = useState(false)
  const [webPrice, setWebPrice] = useState('')
  const [marketPrice, setMarketPrice] = useState('')
  const [webSlug, setWebSlug] = useState('')
  const [webTitle, setWebTitle] = useState('')
  const [webDescription, setWebDescription] = useState('')
  const [webHighlights, setWebHighlights] = useState('')
  const [conditionGrade, setConditionGrade] = useState('')

  const defaultTitle = buildConfigSummary(sku.category, sku.specifications, templates) ||
    [sku.brand, sku.model_name].filter(Boolean).join(' ')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [detailRes, imagesRes] = await Promise.all([
        apiFetch(`/api/sku-master/${sku.id}`),
        apiFetch(`/api/sku-master/${sku.id}/images`),
      ])
      if (cancelled) return
      if (detailRes.ok) {
        const d = await detailRes.json()
        setIsPublished(!!d.is_published)
        setWebPrice(d.web_price != null ? String(d.web_price) : '')
        setMarketPrice(d.market_price != null ? String(d.market_price) : '')
        setWebSlug(d.web_slug || slugify(`${sku.full_sku_code}-${defaultTitle}`))
        setWebTitle(d.web_title || defaultTitle)
        setWebDescription(d.web_description || '')
        setWebHighlights((d.web_highlights || []).join('\n'))
        setConditionGrade(d.web_condition_grade || '')
      }
      if (imagesRes.ok) setImages(await imagesRes.json())
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku.id])

  const refreshImages = async () => {
    const res = await apiFetch(`/api/sku-master/${sku.id}/images`)
    if (res.ok) setImages(await res.json())
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    try {
      for (const file of files) {
        const dims = await new Promise<{ width: number; height: number }>((resolve) => {
          const img = new window.Image()
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
          img.onerror = () => resolve({ width: 0, height: 0 })
          img.src = URL.createObjectURL(file)
        })

        const urlRes = await apiFetch('/api/storage/upload-url', {
          method: 'POST',
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            bucket: 'product-images',
            folder: `products/${sku.id}`,
            fileType: 'photo',
          }),
        })
        if (!urlRes.ok) throw new Error('Could not get upload URL')
        const { uploadUrl, key } = await urlRes.json()

        await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })

        await apiFetch(`/api/sku-master/${sku.id}/images`, {
          method: 'POST',
          body: JSON.stringify({ storage_path: key, width: dims.width, height: dims.height }),
        })
      }
      await refreshImages()
    } catch (err: any) {
      toast.error(err.message || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleSetPrimary = async (imageId: string) => {
    await apiFetch(`/api/sku-master/${sku.id}/images/${imageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_primary: true }),
    })
    refreshImages()
  }

  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const handleDeleteImage = async (imageId: string) => {
    if (deletingImageId) return
    setDeletingImageId(imageId)
    try {
      await apiFetch(`/api/sku-master/${sku.id}/images/${imageId}`, { method: 'DELETE' })
      await refreshImages()
    } finally {
      setDeletingImageId(null)
    }
  }

  const handleSave = async () => {
    if (isPublished && images.length === 0) {
      toast.error('Add at least one photo before publishing.')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch(`/api/sku-master/${sku.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          is_published: isPublished,
          web_price: webPrice ? Number(webPrice) : null,
          market_price: marketPrice ? Number(marketPrice) : null,
          web_slug: webSlug || null,
          web_title: webTitle || null,
          web_description: webDescription || null,
          web_highlights: webHighlights.split('\n').map((s) => s.trim()).filter(Boolean),
          web_condition_grade: conditionGrade || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Save failed')
      }
      toast.success(isPublished ? 'Published to website' : 'Saved')
      onSaved()
      onClose()
    } catch (err: any) {
      toast.error(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SimpleModal isOpen onClose={onClose} title={`Website — ${sku.full_sku_code}`} wide>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
            Published on digitalbluez.com
          </label>

          <div>
            <p className="text-sm font-medium mb-2">Photos</p>
            <div className="flex flex-wrap gap-3 mb-2">
              {images.map((img) => (
                <div key={img.id} className="relative w-24 h-24 rounded-md overflow-hidden border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={publicImageUrl(img.storage_path)} alt={img.alt_text || ''} className="w-full h-full object-cover" />
                  {img.is_primary && (
                    <span className="absolute top-1 left-1 bg-warning text-warning-foreground rounded-full p-0.5">
                      <Star className="size-3" fill="currentColor" />
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 px-1 py-0.5">
                    {!img.is_primary && (
                      <button type="button" onClick={() => handleSetPrimary(img.id)} title="Make primary" className="text-white">
                        <Star className="size-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteImage(img.id)}
                      disabled={deletingImageId === img.id}
                      title="Delete"
                      className="text-white ml-auto"
                    >
                      {deletingImageId === img.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                    </button>
                  </div>
                </div>
              ))}
              <label className="w-24 h-24 flex flex-col items-center justify-center rounded-md border-2 border-dashed text-muted-foreground cursor-pointer hover:border-primary/40">
                {uploading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
                <span className="text-xs mt-1">{uploading ? 'Uploading' : 'Add'}</span>
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Web Price (₹)</label>
              <input type="number" value={webPrice} onChange={(e) => setWebPrice(e.target.value)}
                placeholder={sku.selling_price_default != null ? String(sku.selling_price_default) : ''}
                className="border p-2 w-full rounded" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">MRP / Market Price (₹)</label>
              <input type="number" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)} className="border p-2 w-full rounded" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">URL slug</label>
            <input type="text" value={webSlug} onChange={(e) => setWebSlug(slugify(e.target.value))} className="border p-2 w-full rounded font-mono text-sm" />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Title</label>
            <input type="text" value={webTitle} onChange={(e) => setWebTitle(e.target.value)} className="border p-2 w-full rounded" />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Description</label>
            <textarea value={webDescription} onChange={(e) => setWebDescription(e.target.value)} rows={3} className="border p-2 w-full rounded" />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Highlights (one per line)</label>
            <textarea value={webHighlights} onChange={(e) => setWebHighlights(e.target.value)} rows={3} className="border p-2 w-full rounded" placeholder={'Fast SSD storage\n6 month warranty\nFree delivery'} />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Condition grade</label>
            <select value={conditionGrade} onChange={(e) => setConditionGrade(e.target.value)} className="border p-2 w-full rounded">
              <option value="">Not set</option>
              {CONDITION_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded border">Cancel</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}
    </SimpleModal>
  )
}
