// Common GST state codes -- the first two digits of any Indian GSTIN encode
// the registration state (e.g. '09AAICD2790D1ZM' -> Uttar Pradesh). This is
// the complete official list: a GSTR-1 place-of-supply column has to render
// every code, so unlike the earlier partial map there is no silent fallback
// to a bare numeric code for the rarer union territories.
export const STATE_CODE_TO_NAME: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  // 25 (Daman and Diu) and 28 (pre-bifurcation Andhra Pradesh) are retired --
  // kept so historical invoices and old customer records still render a name.
  '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '28': 'Andhra Pradesh (old)', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction',
}

export function stateCodeFromGstin(gstin?: string | null): string | null {
  const trimmed = gstin?.trim()
  return trimmed && trimmed.length >= 2 ? trimmed.slice(0, 2) : null
}

export function stateNameFromCode(stateCode?: string | null): string | null {
  return stateCode ? STATE_CODE_TO_NAME[stateCode] || null : null
}

// Structural shape of a GSTIN: 2-digit state code, 10-char PAN, 1 entity
// digit, 'Z' (currently fixed for normal taxpayers), 1 check character.
const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/

const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * Validates a GSTIN's 15th character, which is a mod-36 check digit over the
 * first 14. Each character's value (0-9 then A-Z = 10-35) is multiplied by an
 * alternating 1/2 factor; the quotient and remainder of that product divided
 * by 36 are both added to a running sum. This is a purely local check -- it
 * catches transposed and mistyped digits without an API call, which is why it
 * is worth running on every customer save rather than only on lookup.
 *
 * Note it proves the number is *well-formed*, never that it is *registered or
 * active* -- only the taxpayer lookup in /api/gst can speak to that.
 */
export function isValidGstinChecksum(gstin?: string | null): boolean {
  const value = gstin?.trim().toUpperCase()
  if (!value || value.length !== 15) return false

  let sum = 0
  for (let i = 0; i < 14; i++) {
    const charValue = GSTIN_CHARSET.indexOf(value[i])
    if (charValue < 0) return false
    const product = charValue * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }

  const expected = GSTIN_CHARSET[(36 - (sum % 36)) % 36]
  return value[14] === expected
}

/**
 * Full GSTIN validation: format, checksum, and -- when a state is known from
 * the customer/vendor record -- that the embedded state code agrees with it.
 * Returns a reason code rather than a bare boolean so the GST exception
 * report can distinguish a typo from a genuine state mismatch.
 */
export function validateGstin(
  gstin?: string | null,
  expectedStateCode?: string | null
): { valid: boolean; reason?: 'missing' | 'bad_format' | 'bad_checksum' | 'state_mismatch' } {
  const value = gstin?.trim().toUpperCase()
  if (!value) return { valid: false, reason: 'missing' }
  if (!GSTIN_FORMAT.test(value)) return { valid: false, reason: 'bad_format' }
  if (!isValidGstinChecksum(value)) return { valid: false, reason: 'bad_checksum' }

  const expected = expectedStateCode?.trim()
  if (expected && value.slice(0, 2) !== expected) {
    return { valid: false, reason: 'state_mismatch' }
  }
  return { valid: true }
}
