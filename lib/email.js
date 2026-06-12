// Transactional email, provider-agnostic. Config via env, graceful no-op when
// unset. Supports Resend's HTTP API (no SDK) and a console transport for dev.
//
//   EMAIL_TRANSPORT = resend | console        (default: resend)
//   RESEND_API_KEY  = re_xxx                   (for resend)
//   EMAIL_FROM      = World Cup Pool <hello@wcpool.app>
//   APP_URL         = https://wcpool.app

const TRANSPORT = process.env.EMAIL_TRANSPORT || 'resend';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'World Cup Pool <onboarding@resend.dev>';

export function emailEnabled() {
  if (TRANSPORT === 'console') return true;
  return !!RESEND_KEY;
}

export function emailConfigNote() {
  if (emailEnabled()) return TRANSPORT === 'console' ? 'console (dev)' : 'ready (resend)';
  return 'not configured (missing RESEND_API_KEY)';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeEmail(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  return EMAIL_RE.test(s) ? s : null;
}

export async function sendEmail({ to, subject, html, text }) {
  if (TRANSPORT === 'console') {
    console.log(`[email→${to}] ${subject}\n${text || html}`);
    return { ok: true, id: 'console' };
  }
  if (!emailEnabled()) { console.warn('[email] skip (not configured):', to); return { skipped: true }; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[email] send failed', res.status, data.message || data.name);
      return { ok: false, status: res.status, error: data.message || 'send failed' };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    console.error('[email] network error', e.message);
    return { ok: false, error: e.message };
  }
}

export async function sendMany(list) {
  const results = await Promise.all(list.map((m) => sendEmail(m).catch((e) => ({ ok: false, error: e.message }))));
  return { sent: results.filter((r) => r.ok).length, total: list.length, results };
}

// Branded magic-link email.
export function magicLinkEmail({ link, code, poolNames }) {
  const pools = poolNames && poolNames.length
    ? `<p style="color:#9fb0e8;font-size:14px">This gets you back into: <b style="color:#eef2ff">${poolNames.map(esc).join(', ')}</b>.</p>` : '';
  const html = `
  <div style="background:#0b1437;padding:32px 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#1a2659;border:1px solid #2d3f8f;border-radius:16px;padding:28px;color:#eef2ff">
      <div style="font-size:34px">⚽</div>
      <h1 style="font-size:20px;margin:8px 0 4px">Get back into World Cup Pool</h1>
      <p style="color:#9fb0e8;font-size:14px;margin:0 0 20px">Tap the button to restore your draws on this device. This link expires in 30 minutes.</p>
      ${pools}
      <a href="${esc(link)}" style="display:block;text-align:center;background:#28bd88;color:#05241a;font-weight:800;font-size:16px;text-decoration:none;padding:14px;border-radius:12px;margin:18px 0">Log me back in →</a>
      <p style="color:#9fb0e8;font-size:13px">Or enter this code: <b style="color:#e4be6a;font-size:18px;letter-spacing:2px">${esc(code)}</b></p>
      <p style="color:#5a6aa0;font-size:12px;margin-top:18px">If you didn't request this, you can ignore it.</p>
    </div>
  </div>`;
  const text = `Get back into World Cup Pool.\nTap to log in: ${link}\nOr enter code: ${code}\n(Expires in 30 minutes.)`;
  return { html, text };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
