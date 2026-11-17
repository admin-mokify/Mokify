// Relay servers for meetings (susitikimai.html).
//
// This file runs on Cloudflare's servers, not in the browser: Cloudflare
// Pages turns everything in the "functions" folder into server code, and
// this one answers POST /api/ice.
//
// Why it exists: in a meeting, sound and picture go from browser to browser.
// Connected directly, each student's browser would learn the others' network
// (IP) addresses. So every connection goes through a relay server instead
// (Cloudflare Realtime TURN), and the browsers only ever see the relay.
// The relay passes the encrypted sound and picture along without being able
// to open it.
//
// Using the relay needs a short-lived password. Handing those out needs
// Mokify's secret relay key, which must never reach a browser, so it lives
// here. A student only gets a password while the database says they are
// inside a meeting right now.
//
// Setup (Cloudflare dashboard, once):
//  1. Open "Realtime" (it may be listed under "Media") and create a TURN
//     key (the dashboard may call it a TURN app or TURN server). It gives
//     two values: a key ID ("Turn Token ID") and an API token. The token is
//     shown only once.
//  2. Workers & Pages -> mokify -> Settings -> Variables and Secrets, for
//     both Production and Preview, add as type "Secret":
//       TURN_KEY_ID         = the key ID
//       TURN_KEY_API_TOKEN  = the API token
//  3. Same place, the usage limit below needs two more:
//       CF_ACCOUNT_ID       = the Cloudflare account ID (type "Text")
//       CF_ANALYTICS_TOKEN  = an API token whose only permission is
//                             Account -> Account Analytics -> Read ("Secret")
//  4. Deploy again (Deployments -> Retry deployment), so the function sees them.
// Until then meetings don't start: the page says they are unavailable
// instead of connecting students directly.
//
// Cost: Cloudflare counts the data the relay sends to students. The first
// 1,000 GB a month are free, then $0.05 per GB. A four-person video call
// uses roughly 3 GB an hour, a one-on-one lesson (720p) about 1.1 GB.
//
// Mokify must never pay for it, so before handing out a relay password this
// file asks Cloudflare how much the relay has sent in the last 30 days and
// stops at USAGE_LIMIT_BYTES. The gap to 1,000 GB covers calls still running
// when the limit is reached (a password works RELAY_PASSWORD_SECONDS at most)
// and Cloudflare's numbers arriving a few minutes late. If the usage can't be
// read, no password is handed out either. GET /api/ice shows the current
// figures.

// Same values as assets/js/config.js (both are public).
const SUPABASE_URL = 'https://wswryravelakztdkiysq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GBV4VAh97BILvQ_ZNDoTyw_2S_x_xUu';

// How long a relay password works. Longer than a usual lesson; the page asks
// for a new one when it needs to reconnect later. Kept short so calls can't
// run on for long after the usage limit is reached.
const RELAY_PASSWORD_SECONDS = 2 * 60 * 60;

// The free 1,000 GB minus a safety margin (see the top of this file). A
// rolling 30 days is used instead of the calendar month because Cloudflare's
// billing month may start on any day.
const USAGE_LIMIT_BYTES = 800e9;
const USAGE_WINDOW_DAYS = 30;
// Asking Cloudflare on every password would be slow; the answer is reused
// for this long.
const USAGE_CACHE_SECONDS = 5 * 60;
const USAGE_CACHE_KEY = 'https://relay-usage.mokify.invalid/v1';

// Cloudflare offers the relay at half a dozen addresses. A browser tries
// every one it is given, and more than a few slows connecting down. Three
// cover every network: the normal way (UDP), and two that get through
// school and office firewalls (web port 80, and port 443 wrapped in TLS).
const PREFERRED_RELAYS = [
  /^turn:[^?]+:3478\?transport=udp$/,
  /^turns:[^?]+:443\?transport=tcp$/,
  /^turn:[^?]+:80\?transport=tcp$/,
];

function pickRelayAddresses(urls) {
  const preferred = PREFERRED_RELAYS.map((pattern) => urls.find((url) => pattern.test(url))).filter(Boolean);
  return preferred.length ? preferred : urls.slice(0, 3);
}

// How many bytes the relay sent to students in the last USAGE_WINDOW_DAYS,
// from Cloudflare's own analytics. null when it can't be read.
async function fetchRelayUsage(env) {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return null;
  const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  const query = `query ($account: String!, $from: Date!, $to: Date!) {
    viewer { accounts(filter: { accountTag: $account }) {
      callsTurnUsageAdaptiveGroups(limit: 10000, filter: { date_geq: $from, date_leq: $to }) { sum { egressBytes } }
    } }
  }`;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { account: env.CF_ACCOUNT_ID, from: day(USAGE_WINDOW_DAYS), to: day(0) } }),
    });
    if (!res.ok) return null;
    const answer = await res.json();
    const account = answer && !answer.errors && answer.data && answer.data.viewer && answer.data.viewer.accounts && answer.data.viewer.accounts[0];
    const rows = account && account.callsTurnUsageAdaptiveGroups;
    if (!Array.isArray(rows)) return null;
    let bytes = 0;
    for (const row of rows) {
      const value = Number(row && row.sum && row.sum.egressBytes);
      if (!Number.isFinite(value) || value < 0) return null;
      bytes += value;
    }
    return bytes;
  } catch {
    return null;
  }
}

// { known, bytes, open }: open is true only when the usage is known and under
// the limit.
async function relayUsage(env) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    try {
      const hit = await cache.match(USAGE_CACHE_KEY);
      if (hit) return await hit.json();
    } catch {
      // Unreadable cache: ask Cloudflare again.
    }
  }
  const bytes = await fetchRelayUsage(env);
  const usage = { known: bytes !== null, bytes, open: bytes !== null && bytes < USAGE_LIMIT_BYTES };
  if (cache && usage.known) {
    try {
      await cache.put(USAGE_CACHE_KEY, new Response(JSON.stringify(usage), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${USAGE_CACHE_SECONDS}` },
      }));
    } catch {
      // Not cached: the next request asks Cloudflare again.
    }
  }
  return usage;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  },
});

export async function onRequestPost({ request, env }) {
  // Only Mokify's own pages ask; a request sent from another website's page
  // is refused (browsers always say where such a request comes from).
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'forbidden' }, 403);

  const authorization = request.headers.get('Authorization') || '';
  const login = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  let code = '';
  try {
    const body = await request.json();
    if (body && typeof body.code === 'string') code = body.code;
  } catch {
    // Not JSON: refused below.
  }
  if (!login || login.length > 4096 || !/^[A-Za-z0-9-]{12,20}$/.test(code)) return json({ error: 'bad_request' }, 400);

  // The database checks the student's login, that their school's
  // subscription is running, and that they are inside this meeting. It also
  // limits how often one student may ask (meeting_relay_ticket in
  // supabase/updates/2026-11-13-meetings.sql).
  let ticket = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/meeting_relay_ticket`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${login}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
    });
    if (res.ok) ticket = await res.json();
  } catch {
    return json({ error: 'unavailable' }, 502);
  }
  if (!ticket || ticket.ok !== true) return json({ error: 'forbidden' }, 403);

  // The relay key isn't set up yet (see the top of this file).
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ relay: false, iceServers: [] });

  // The free monthly amount is (nearly) used up, or the usage can't be
  // checked: no new relay passwords until it is safe again.
  const usage = await relayUsage(env);
  if (!usage.open) return json({ relay: false, limit: usage.known, iceServers: [] });

  let answer;
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: RELAY_PASSWORD_SECONDS }),
      },
    );
    if (!res.ok) return json({ error: 'unavailable' }, 502);
    answer = await res.json();
  } catch {
    return json({ error: 'unavailable' }, 502);
  }

  // Keep the relay (turn:/turns:) addresses only. Port 53 is left out
  // because browsers refuse to connect to it.
  const iceServers = [].concat((answer && answer.iceServers) || [])
    .map((server) => ({
      urls: pickRelayAddresses([].concat((server && server.urls) || []).filter((url) => typeof url === 'string' && /^turns?:/.test(url) && !/:53(\?|$)/.test(url))),
      username: server && server.username,
      credential: server && server.credential,
    }))
    .filter((server) => server.urls.length && typeof server.username === 'string' && typeof server.credential === 'string');
  if (!iceServers.length) return json({ error: 'unavailable' }, 502);

  return json({ relay: true, iceServers });
}

// The relay's usage against the limit, for checking the setup. Only totals,
// nothing about who called.
export async function onRequestGet({ env }) {
  const relayKey = Boolean(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN);
  const usage = await relayUsage(env);
  return json({
    relayKey,
    usageKnown: usage.known,
    usedGB: usage.known ? Math.round(usage.bytes / 1e7) / 100 : null,
    limitGB: USAGE_LIMIT_BYTES / 1e9,
    windowDays: USAGE_WINDOW_DAYS,
    meetingsOpen: relayKey && usage.open,
  });
}

// Anything but GET and POST.
export function onRequest() {
  return json({ error: 'method_not_allowed' }, 405);
}
