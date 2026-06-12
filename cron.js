// Tiny cron entrypoint — run by a Railway cron-scheduled service.
//
// It does no work itself: it just pings one or more job endpoints on the web
// service (where the DB + websockets live) and exits. This keeps scheduling
// decoupled from business logic, so adding a new scheduled task is two steps:
//   1. register the job in server.js (the JOBS map)
//   2. point a cron service at it via the CRON_JOBS env var + a cronSchedule
//
// Env:
//   WEB_URL      base URL of the web service (e.g. https://...up.railway.app)
//   CRON_SECRET  shared secret; sent as the x-cron-key header
//   CRON_JOBS    comma-separated job names to run (default: "sync")

const BASE = (process.env.WEB_URL || '').replace(/\/+$/, '');
const KEY = process.env.CRON_SECRET || '';
const JOBS = (process.env.CRON_JOBS || 'sync').split(',').map((s) => s.trim()).filter(Boolean);

if (!BASE || !KEY) {
  console.error('[cron] missing WEB_URL or CRON_SECRET — nothing to do');
  process.exit(1);
}

let failed = 0;
for (const job of JOBS) {
  const started = Date.now();
  try {
    const r = await fetch(`${BASE}/api/cron/${job}`, {
      method: 'POST',
      headers: { 'x-cron-key': KEY },
    });
    const body = await r.json().catch(() => ({}));
    const ms = Date.now() - started;
    if (!r.ok) { failed++; console.error(`[cron] ${job} -> HTTP ${r.status} (${ms}ms)`, JSON.stringify(body)); }
    else console.log(`[cron] ${job} ok (${ms}ms)`, JSON.stringify(body));
  } catch (e) {
    failed++;
    console.error(`[cron] ${job} error:`, e.message);
  }
}

process.exit(failed ? 1 : 0);
