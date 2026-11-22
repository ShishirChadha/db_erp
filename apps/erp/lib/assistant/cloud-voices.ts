// Microsoft Azure and Google Cloud voices for DB -- trialled against Sarvam.
// Both read the same reply text: Hindi words in Devanagari and English in Latin
// (see playbooks.ts). A reply containing Devanagari is spoken by the voice's
// hi-IN version, a pure-English reply by its en-IN version, so the same persona
// speaks both languages.
//
// Azure: REST text-to-speech with SSML, key + region (free F0 tier: 500,000
// neural characters a month). Google: Cloud Text-to-Speech v1 with an API key;
// Chirp 3 HD voices (about 1 million characters a month free).

const isHindi = (text: string) => /[ऀ-ॿ]/.test(text)
const clean = (text: string) => text.replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 2400)
const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!))

export interface VoiceOption { id: string; label: string }

// ------------------------------------------------------------------ Azure

const azureCache = new Map<string, { at: number; voices: any[] }>()

async function azureVoiceList(key: string, region: string): Promise<any[]> {
  const hit = azureCache.get(region)
  if (hit && Date.now() - hit.at < 3600_000) return hit.voices
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { 'Ocp-Apim-Subscription-Key': key }, signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Azure rejected the key or region (${res.status}).`)
  const voices = (await res.json()) as any[]
  azureCache.set(region, { at: Date.now(), voices })
  return voices
}

// Female personas that exist for Hindi (India), labelled with whether they
// also have an English (India) version.
export async function azureFemaleVoices(key: string, region: string): Promise<VoiceOption[]> {
  const voices = await azureVoiceList(key, region)
  const persona = (v: any) => String(v.ShortName).split('-')[2]?.replace(/Neural$/, '')
  const hi = voices.filter((v) => v.Locale === 'hi-IN' && v.Gender === 'Female')
  const en = new Set(voices.filter((v) => v.Locale === 'en-IN' && v.Gender === 'Female').map(persona))
  return hi.map((v) => ({ id: persona(v), label: `${persona(v)} — Hindi${en.has(persona(v)) ? ' + English' : ''}` }))
}

export async function azureSynthesize(key: string, region: string, persona: string, text: string, pace: number) {
  const body = clean(text)
  const voices = await azureVoiceList(key, region)
  const locale = isHindi(body) ? 'hi-IN' : 'en-IN'
  const wanted = `${locale}-${persona}Neural`
  // Fall back to the Hindi voice for English text when the persona has no en-IN twin.
  const name = voices.some((v) => v.ShortName === wanted) ? wanted : `hi-IN-${persona}Neural`
  const rate = `${Math.round((pace - 1) * 100) >= 0 ? '+' : ''}${Math.round((pace - 1) * 100)}%`
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${name}"><prosody rate="${rate}">${escapeXml(body)}</prosody></voice></speak>`
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'digitalbluez-erp',
    },
    body: ssml,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Azure text-to-speech failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return { audio: Buffer.from(await res.arrayBuffer()).toString('base64'), characters: body.length }
}

// ------------------------------------------------------------------ Google

let googleCache: { at: number; voices: any[] } | null = null

async function googleVoiceList(key: string): Promise<any[]> {
  if (googleCache && Date.now() - googleCache.at < 3600_000) return googleCache.voices
  const res = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=hi-IN&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15_000) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `Google rejected the key (${res.status}).`)
  const resEn = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=en-IN&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15_000) })
  const dataEn = await resEn.json().catch(() => ({}))
  googleCache = { at: Date.now(), voices: [...(data.voices || []), ...(dataEn.voices || [])] }
  return googleCache.voices
}

// Chirp 3 HD female voices available for Hindi (India).
export async function googleFemaleVoices(key: string): Promise<VoiceOption[]> {
  const voices = await googleVoiceList(key)
  const chirpName = (n: string) => n.match(/Chirp3-HD-(\w+)$/)?.[1]
  const hi = voices.filter((v) => v.ssmlGender === 'FEMALE' && /^hi-IN-Chirp3-HD-/.test(v.name))
  const en = new Set(voices.filter((v) => /^en-IN-Chirp3-HD-/.test(v.name)).map((v) => chirpName(v.name)))
  return hi.map((v) => {
    const n = chirpName(v.name)!
    return { id: n, label: `${n} — Hindi${en.has(n) ? ' + English' : ''} (Chirp 3 HD)` }
  })
}

export async function googleSynthesize(key: string, voice: string, text: string, pace: number) {
  const body = clean(text)
  const languageCode = isHindi(body) ? 'hi-IN' : 'en-IN'
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { text: body },
      voice: { languageCode, name: `${languageCode}-Chirp3-HD-${voice}` },
      audioConfig: { audioEncoding: 'MP3', speakingRate: pace },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `Google text-to-speech failed (${res.status})`)
  return { audio: String(data.audioContent || ''), characters: body.length }
}

// ------------------------------------------------------------------ Azure listening
//
// Speech-to-text REST API for short audio (max 60 s, final result only), with
// the same key and region as her Azure voice. Used when the browser can't
// recognise speech itself (e.g. DuckDuckGo on Android, an Android WebView).
// The panel records 16 kHz mono WAV. Free tier F0: 5 audio hours a month.
export async function azureTranscribe(key: string, region: string, wav: ArrayBuffer, language: string) {
  const res = await fetch(
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=simple&profanity=raw`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        Accept: 'application/json',
      },
      body: wav,
      signal: AbortSignal.timeout(30_000),
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Azure speech-to-text failed (${res.status})${data?.error?.message ? `: ${data.error.message}` : ''}`)
  // NoMatch / InitialSilenceTimeout = nothing intelligible was said.
  return { text: data.RecognitionStatus === 'Success' ? String(data.DisplayText || '').trim() : '', status: String(data.RecognitionStatus || '') }
}
