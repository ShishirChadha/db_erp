import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

// Reversible storage for non-owner account passwords, so the owner can look one up
// later from Settings instead of always resetting it. Owner accounts must never be
// encrypted/stored here -- that's enforced by the callers (app/api/users routes),
// not this module. Key lives only in server env (PASSWORD_VAULT_KEY), never in the
// DB, so a DB-only compromise doesn't expose stored passwords on its own.
const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const hex = process.env.PASSWORD_VAULT_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('PASSWORD_VAULT_KEY must be set to a 32-byte (64 hex char) value.')
  }
  return Buffer.from(hex, 'hex')
}

// Stored format: base64(iv[12] + authTag[16] + ciphertext)
export function encryptPassword(plain: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

export function decryptPassword(stored: string): string {
  const key = getKey()
  const raw = Buffer.from(stored, 'base64')
  const iv = raw.subarray(0, 12)
  const authTag = raw.subarray(12, 28)
  const ciphertext = raw.subarray(28)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
