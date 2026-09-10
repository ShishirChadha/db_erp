import { z } from 'zod'

// Structured shapes the marketing generator's forced tool-calls return. Deliberately
// carries NO numeric or spec fields -- price, specs, warranty terms and availability
// are always injected into the prompt from real DB rows and re-inserted verbatim into
// the final asset by lib/marketing/generate.ts, never sourced from the model's own
// output. This mirrors lib/recon/schemas.ts's "transcribe, don't compute" posture,
// inverted for generation: "phrase, don't invent facts."

export const SocialPostSchema = z.object({
  title: z.string().nullable().optional().describe('Short internal label for this draft, not shown to customers'),
  body_text: z.string().describe('The post/message copy itself, with emojis where natural for the platform. Must NOT include any price, spec value, or warranty term as a number -- those are inserted separately from real data.'),
  hashtags: z.array(z.string()).describe('Hashtags without the # prefix, most relevant first'),
  cta_text: z.string().describe('A short call-to-action line, e.g. "DM to book yours" or "Call now"'),
  alt_text: z.string().nullable().optional().describe('Accessibility alt text for the attached image, if any'),
})
export type SocialPost = z.infer<typeof SocialPostSchema>

export const BlogDraftSchema = z.object({
  title: z.string(),
  meta_title: z.string().describe('SEO title, under 60 characters'),
  meta_description: z.string().describe('SEO meta description, under 160 characters'),
  excerpt: z.string().describe('1-2 sentence summary shown in the blog list'),
  body_markdown: z.string().describe('The full post in simple markdown (headings, bold, lists). Must not state any price, spec value, or warranty term as a number for a specific product -- those get inserted as real links, not restated as prose facts.'),
  tags: z.array(z.string()),
})
export type BlogDraft = z.infer<typeof BlogDraftSchema>
