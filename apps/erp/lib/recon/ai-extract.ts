import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import {
  VendorInvoiceExtractionSchema,
  BankStatementExtractionSchema,
  type VendorInvoiceExtraction,
  type BankStatementExtraction,
} from './schemas'

// Tier 2 of the document ingestion pipeline: the only tier that costs money, and the
// only tier ever invoked without a template already in hand -- callers MUST gate
// this behind an explicit owner approval (see POST /api/documents/[id]/parse-ai),
// never call it automatically from Tier 0/1. Model transcribes; lib/recon/validate.ts
// re-derives the arithmetic -- this module never reports a total as trustworthy on
// its own.

const MODEL = 'claude-sonnet-5'

export interface AiExtractResult<T> {
  data: T
  inputTokens: number
  outputTokens: number
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to apps/erp/.env.local to enable AI-assisted extraction (Tier 2). Tier 0/1 (text-layer probe + saved templates) work without it.'
    )
  }
  return new Anthropic({ apiKey })
}

async function extractViaTool<T>(params: {
  toolName: string
  toolDescription: string
  schema: z.ZodType<T>
  content: Anthropic.MessageParam['content']
}): Promise<AiExtractResult<T>> {
  const client = getClient()
  const inputSchema = z.toJSONSchema(params.schema, { target: 'draft-7' }) as Anthropic.Tool.InputSchema

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [{ name: params.toolName, description: params.toolDescription, input_schema: inputSchema }],
    tool_choice: { type: 'tool', name: params.toolName },
    messages: [{ role: 'user', content: params.content }],
  })

  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) throw new Error('Model did not return a structured extraction.')

  const parsed = params.schema.safeParse(toolUse.input)
  if (!parsed.success) {
    throw new Error(`Extraction did not match expected shape: ${parsed.error.message}`)
  }

  return {
    data: parsed.data,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  }
}

// Text-layer PDFs: send the extracted text only (cheap -- no image tokens). Scanned
// PDFs / phone photos: send the raw PDF bytes as a document content block, which
// Claude renders and reads natively -- no separate OCR or page-rasterization step
// needed on our side.

export async function extractVendorInvoiceFromText(text: string): Promise<AiExtractResult<VendorInvoiceExtraction>> {
  return extractViaTool({
    toolName: 'record_invoice_extraction',
    toolDescription: 'Record the structured contents of a vendor invoice, transcribed exactly as printed. Do not compute or correct any totals -- transcribe every number exactly as it appears, even if the source document\'s own arithmetic looks wrong.',
    schema: VendorInvoiceExtractionSchema,
    content: `Transcribe this vendor invoice's text into the record_invoice_extraction tool. Every field must be copied exactly as printed -- do not calculate, round, or "correct" any number.\n\n---\n${text}`,
  })
}

export async function extractVendorInvoiceFromPdf(pdfBase64: string): Promise<AiExtractResult<VendorInvoiceExtraction>> {
  return extractViaTool({
    toolName: 'record_invoice_extraction',
    toolDescription: 'Record the structured contents of a vendor invoice, transcribed exactly as printed. Do not compute or correct any totals -- transcribe every number exactly as it appears, even if the source document\'s own arithmetic looks wrong.',
    schema: VendorInvoiceExtractionSchema,
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
      { type: 'text', text: 'Transcribe this vendor invoice into the record_invoice_extraction tool. Every field must be copied exactly as printed -- do not calculate, round, or "correct" any number.' },
    ],
  })
}

export async function extractBankStatementFromText(text: string): Promise<AiExtractResult<BankStatementExtraction>> {
  return extractViaTool({
    toolName: 'record_statement_extraction',
    toolDescription: 'Record the structured contents of a bank statement, transcribed exactly as printed. Do not compute or correct any balances -- transcribe every row exactly as it appears.',
    schema: BankStatementExtractionSchema,
    content: `Transcribe this bank statement's text into the record_statement_extraction tool. Every row and balance must be copied exactly as printed -- do not calculate or "correct" anything.\n\n---\n${text}`,
  })
}

export async function extractBankStatementFromPdf(pdfBase64: string): Promise<AiExtractResult<BankStatementExtraction>> {
  return extractViaTool({
    toolName: 'record_statement_extraction',
    toolDescription: 'Record the structured contents of a bank statement, transcribed exactly as printed. Do not compute or correct any balances -- transcribe every row exactly as it appears.',
    schema: BankStatementExtractionSchema,
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
      { type: 'text', text: 'Transcribe this bank statement into the record_statement_extraction tool. Every row and balance must be copied exactly as printed -- do not calculate or "correct" anything.' },
    ],
  })
}
