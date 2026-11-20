// Sarvam AI speech for DB: listening (saaras:v4) and speaking (bulbul:v4-flash).
// Indian voices that handle English, Hindi and Hinglish, replacing the browser's
// built-in speech, which sounded robotic and misheard Hinglish ("Hi DB" -> "IDBI").
// Request shapes per docs.sarvam.ai (speech-to-text/transcribe, text-to-speech/convert).
const BASE = 'https://api.sarvam.ai'
export const STT_MODEL = 'saaras:v4'
export const TTS_MODEL = 'bulbul:v4-flash'

// Words the recogniser should expect -- DB's name and the trade's vocabulary.
const KEYTERMS = [
  'DB', 'Digitalbluez', 'Techtenth', 'PI', 'proforma', 'quotation', 'GST', 'HSN', 'invoice',
  'EliteBook', 'ProBook', 'ThinkPad', 'Latitude', 'Vostro', 'Inspiron', 'MacBook', 'ProDesk', 'OptiPlex',
  'HP', 'Dell', 'Lenovo', 'Apple', 'i5', 'i7', 'SSD', 'RAM', '8GB', '16GB', '256GB', '512GB',
  'Sanjana', 'Ankit', 'Aakash', 'Ayush', 'Shishir', 'Cash', 'repair', 'replacement', 'expense',
]

export async function transcribe(key: string, audio: Blob, filename: string) {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', STT_MODEL)
  // codemix: Hindi words in Devanagari, English words in Latin -- keeps
  // Hinglish intact instead of forcing it into one language.
  form.append('mode', 'codemix')
  form.append('language_code', 'unknown')
  form.append('keyterms', JSON.stringify(KEYTERMS))
  const res = await fetch(`${BASE}/speech-to-text`, {
    method: 'POST', headers: { 'api-subscription-key': key }, body: form, signal: AbortSignal.timeout(30_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `Sarvam speech-to-text failed (${res.status})`)
  return { text: String(data.transcript || '').trim(), language: (data.language_code as string | null) ?? null }
}

export async function synthesize(key: string, text: string, speaker: string, pace: number) {
  const clean = text.replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 2400)
  const language = /[ऀ-ॿ]/.test(clean) ? 'hi-IN' : 'en-IN'
  const res = await fetch(`${BASE}/text-to-speech`, {
    method: 'POST',
    headers: { 'api-subscription-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      text: clean, language_code: language, speaker, model: TTS_MODEL, pace,
      output_audio_codec: 'mp3', speech_sample_rate: 24000, enable_preprocessing: true,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `Sarvam text-to-speech failed (${res.status})`)
  return { audio: (data.audios?.[0] as string) || '', characters: clean.length }
}
