// Twilio SMS over the REST API (no SDK). All config via env, so the app runs
// fine with texting switched off — every send is a graceful no-op until set.
//
// Auth supports both Twilio styles:
//   - Account SID + Auth Token        (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)
//   - API Key SID + Secret            (TWILIO_API_KEY_SID + TWILIO_AUTH_TOKEN)
// Sender can be a phone number (+1...) or a Messaging Service SID (MG...).

const SID = process.env.TWILIO_ACCOUNT_SID || '';
const API_KEY = process.env.TWILIO_API_KEY_SID || '';            // optional, SK...
const AUTH = process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH || '';
const FROM = process.env.TWILIO_FROM || '';                      // +1... or MG...
const DEFAULT_CC = process.env.TWILIO_DEFAULT_CC || '1';         // assumed country code
const TRANSPORT = process.env.SMS_TRANSPORT || 'twilio';         // 'twilio' | 'console'

export function smsEnabled() {
  if (TRANSPORT === 'console') return true;                      // dev/test: log instead of send
  return !!(SID && AUTH && FROM);
}

export function smsConfigNote() {
  if (smsEnabled()) return 'ready';
  const missing = [];
  if (!SID) missing.push('TWILIO_ACCOUNT_SID');
  if (!AUTH) missing.push('TWILIO_AUTH_TOKEN');
  if (!FROM) missing.push('TWILIO_FROM');
  return `not configured (missing ${missing.join(', ')})`;
}

// Best-effort E.164 normalization. Returns null if it can't make sense of it.
export function normalizePhone(input) {
  if (!input) return null;
  let s = String(input).trim();
  const plus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (plus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+${DEFAULT_CC}${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`; // already has CC
  return null;
}

export async function sendSMS(to, body) {
  if (TRANSPORT === 'console') { console.log(`[sms→${to}] ${body}`); return { ok: true, sid: 'console' }; }
  if (!smsEnabled()) { console.warn('[sms] skip (not configured):', to); return { skipped: true }; }
  const user = API_KEY || SID;
  const params = new URLSearchParams({ To: to, Body: body });
  if (FROM.startsWith('MG')) params.set('MessagingServiceSid', FROM);
  else params.set('From', FROM);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${user}:${AUTH}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[sms] send failed', res.status, data.code, data.message);
      return { ok: false, status: res.status, error: data.message || 'send failed' };
    }
    return { ok: true, sid: data.sid };
  } catch (e) {
    console.error('[sms] network error', e.message);
    return { ok: false, error: e.message };
  }
}

// Fire-and-forget to many recipients; never throws.
export async function sendMany(list) {
  const results = await Promise.all(list.map(({ to, body }) => sendSMS(to, body).catch((e) => ({ ok: false, error: e.message }))));
  return { sent: results.filter((r) => r.ok).length, total: list.length, results };
}
