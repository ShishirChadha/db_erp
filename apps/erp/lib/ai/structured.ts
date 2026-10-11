import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

// Forced-tool structured output: the model can only answer by filling a schema, which is then
// re-validated. Same shape as lib/recon/ai-extract.ts and lib/marketing/generate.ts (which keep
// their own private copies); new callers should use this one.
export interface StructuredResult<T> {
  data: T
  inputTokens: number
  outputTokens: number
}

export async function generateStructured<T>(params: {
  toolName: string
  toolDescription: string
  schema: z.ZodType<T>
  system: string
  content: string
  model?: string
  maxTokens?: number
}): Promise<StructuredResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.')
  const client = new Anthropic({ apiKey })
  const inputSchema = z.toJSONSchema(params.schema, { target: 'draft-7' }) as Anthropic.Tool.InputSchema

  const message = await client.messages.create({
    // claude-sonnet-5-5 rejects a forced tool_choice (400); this is the model the other forced-tool
    // callers in the app (recon ai-extract, marketing generate) already run on.
    model: params.model ?? 'claude-sonnet-5',
    max_tokens: params.maxTokens ?? 4096,
    system: params.system,
    tools: [{ name: params.toolName, description: params.toolDescription, input_schema: inputSchema }],
    tool_choice: { type: 'tool', name: params.toolName },
    messages: [{ role: 'user', content: params.content }],
  })
  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) throw new Error('Model did not return structured content.')
  // Models occasionally return an array/object argument as a JSON-encoded string; accept that
  // rather than failing the whole call over a formatting slip.
  const input = Object.fromEntries(Object.entries((toolUse.input ?? {}) as Record<string, unknown>).map(([k, v]) => {
    if (typeof v === 'string' && /^\s*[\[{]/.test(v)) { try { return [k, JSON.parse(v)] } catch { /* keep as-is */ } }
    return [k, v]
  }))
  const parsed = params.schema.safeParse(input)
  if (!parsed.success) throw new Error(`Model output did not match the expected shape: ${parsed.error.message}`)
  return { data: parsed.data, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }
}
