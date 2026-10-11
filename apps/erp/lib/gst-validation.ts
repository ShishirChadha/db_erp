import { validateGstin } from '@/lib/gstStateCodes'

// Shared across every GST Number input (customers, vendors, business profiles) so
// "has GST but left it blank/mistyped" is caught before a write is attempted, not
// discovered later as a silent RLS/constraint failure. `expectedStateCode` is
// optional -- vendors don't store a structured state code, so that check is skipped
// for them.
export function gstValidationError(gstNumber: string, expectedStateCode?: string | null): string | null {
  const value = gstNumber.trim()
  if (!value) return 'GST Number is required.'

  const result = validateGstin(value, expectedStateCode)
  if (result.valid) return null

  switch (result.reason) {
    case 'bad_format':
      return 'Invalid GST number -- must be exactly 15 characters with no spaces (2-digit state code, 10-char PAN, entity code, "Z", checksum).'
    case 'bad_checksum':
      return 'This GST number looks mistyped (checksum failed) -- please double-check it.'
    case 'state_mismatch':
      return `This GST number's state code (${value.slice(0, 2)}) doesn't match the selected state code (${expectedStateCode}).`
    default:
      return 'GST Number is required.'
  }
}
