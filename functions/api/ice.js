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
//  3. Deploy again (Deployments -> Retry deployment), so the function sees them.
// Until then meetings don't start: the page says they are unavailable
// instead of connecting students directly.
//
// Cost: Cloudflare counts the data the relay sends to students. The first
// 1,000 GB a month are free, then $0.05 per GB. A four-person video call
// uses roughly 3 GB an hour.

// Same values as assets/js/config.js (both are public).
const SUPABASE_URL = 'https://wswryravelakztdkiysq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GBV4VAh97BILvQ_ZNDoTyw_2S_x_xUu';

// How long a relay password works. Longer than any meeting a student stays
// in; the page asks for a new one when it needs to reconnect later.
const RELAY_PASSWORD_SECONDS = 6 * 60 * 60;

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

// Anything but POST.
export function onRequest() {
  return json({ error: 'method_not_allowed' }, 405);
}
