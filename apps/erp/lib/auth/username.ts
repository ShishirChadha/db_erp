// Fixed, never-shown domain used to satisfy Supabase Auth's email-shaped requirement
// for username-only logins (profiles.username, e.g. "ShishirCH") -- real contact email
// for notifications, if the owner sets one, lives separately in profiles.contact_email.
// Imported by both the login page (client) and the user-creation API route (server),
// so the two never drift out of sync on how a username becomes an auth email.
export const SYNTHETIC_LOGIN_DOMAIN = 'login.internal'

export function usernameToSyntheticEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${SYNTHETIC_LOGIN_DOMAIN}`
}

// A raw username (no "@") must be transformed before being handed to Supabase Auth;
// an existing account's real email address (has "@") is passed through unchanged --
// this is what lets pre-existing email-based logins keep working after this feature ships.
export function resolveLoginIdentifier(input: string): string {
  const trimmed = input.trim()
  return trimmed.includes('@') ? trimmed : usernameToSyntheticEmail(trimmed)
}
