// Plain inline-styled HTML, matching the simplicity of the ERP's own email
// templates (apps/erp/lib/notifications.ts) -- no build step, no email
// framework, just a string.
export function setPasswordEmailHtml({ name, actionLink }: { name: string; actionLink: string }): string {
  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <p>Hi ${escapeHtml(name)},</p>
      <p>
        Thanks for your order with DigitalBluez. We've set up an account for you so you can
        track this order and check out faster next time.
      </p>
      <p style="margin: 28px 0;">
        <a href="${actionLink}" style="background: #f2672a; color: #ffffff; padding: 12px 24px; border-radius: 999px; text-decoration: none; font-weight: 600; display: inline-block;">
          Set your password
        </a>
      </p>
      <p style="color: #666; font-size: 13px;">
        This link is specific to your account and expires after a while — if it's stopped
        working, just use "Forgot password" at login with this email address instead.
      </p>
      <p style="color: #666; font-size: 13px;">If you didn't place this order, you can ignore this email.</p>
    </div>
  `
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
