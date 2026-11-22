import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/service'
import { isDbMaster, getAssistantSettings, saveAssistantSettings } from '@/lib/assistant/settings'

export const dynamic = 'force-dynamic'

// DB's own picture (Settings -> DB Assistant -> Look and feel -> Your picture).
// A private file in the `documents` bucket, only ever read through this route
// with the master's login -- never a public URL. The panel resizes it to a
// 512 px square before upload, so files are small (~50-150 KB).
const BUCKET = 'documents'
const path = (version: string) => `assistant/avatar/${version}`
const TYPES = ['image/webp', 'image/jpeg', 'image/png']
const MAX_BYTES = 1_500_000

async function master(req: NextRequest) {
  const user = await getSessionUser(req)
  return user && (await isDbMaster(user)) ? user : null
}
const forbidden = () => NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })

export async function GET(req: NextRequest) {
  if (!(await master(req))) return forbidden()
  const version = (await getAssistantSettings()).avatar_photo_version
  if (!version) return NextResponse.json({ error: 'No picture set.' }, { status: 404 })
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path(version))
  if (error || !data) return NextResponse.json({ error: 'Picture not found.' }, { status: 404 })
  return new Response(await data.arrayBuffer(), {
    headers: {
      'Content-Type': TYPES.includes(data.type) ? data.type : 'image/jpeg',
      // Versioned (?v=...), so the browser may keep it; private = this login only.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}

export async function POST(req: NextRequest) {
  const user = await master(req)
  if (!user) return forbidden()
  const form = await req.formData().catch(() => null)
  const file = form?.get('image')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Choose a picture.' }, { status: 400 })
  if (!TYPES.includes(file.type)) return NextResponse.json({ error: 'Use a JPG, PNG or WebP picture.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That picture is too large (max 1.5 MB).' }, { status: 400 })

  const version = Date.now().toString(36)
  const { error } = await supabaseAdmin.storage.from(BUCKET)
    .upload(path(version), await file.arrayBuffer(), { contentType: file.type, upsert: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const previous = (await getAssistantSettings()).avatar_photo_version
  const settings = await saveAssistantSettings({ avatar_photo_version: version }, user.id)
  if (previous) await supabaseAdmin.storage.from(BUCKET).remove([path(previous)])
  return NextResponse.json({ version: settings.avatar_photo_version })
}

export async function DELETE(req: NextRequest) {
  const user = await master(req)
  if (!user) return forbidden()
  const current = await getAssistantSettings()
  if (current.avatar_photo_version) await supabaseAdmin.storage.from(BUCKET).remove([path(current.avatar_photo_version)])
  await saveAssistantSettings({
    avatar_photo_version: '',
    ...(current.appearance.avatar === 'photo' ? { appearance: { ...current.appearance, avatar: 'face' as const } } : {}),
  }, user.id)
  return NextResponse.json({ success: true })
}
