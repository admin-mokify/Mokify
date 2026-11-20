// Checks a YouTube video before it is shown in a meeting or lesson
// (susitikimai.html, pamoka.html): POST /api/youtube { code, url }.
//
// This file runs on Cloudflare's servers, not in the browser. It asks
// YouTube's own records (YouTube Data API) which category the video's creator
// put it in, and only educational categories are allowed. The page that shows
// a video and every page that receives it ask here first, so nobody can push a
// different video by tinkering with their own browser.
//
// Setup (once):
//  1. https://console.cloud.google.com -> create a project (any name, e.g.
//     "Mokify"). No payment details are needed.
//  2. APIs & Services -> Library -> "YouTube Data API v3" -> Enable.
//  3. APIs & Services -> Credentials -> Create credentials -> API key. Then
//     edit the key: API restrictions -> Restrict key -> YouTube Data API v3.
//  4. Cloudflare: Workers & Pages -> mokify -> Settings -> Variables and
//     Secrets, for Production and Preview, add as type "Secret":
//       YOUTUBE_API_KEY = the key
//  5. Deploy again (Deployments -> Retry deployment).
// Until then the page says videos aren't switched on yet.
//
// Cost: free. YouTube gives 10,000 units a day; one check costs 1 unit, and
// each video's answer is remembered for a day (CACHE_SECONDS), so asking about
// the same video again costs nothing.

// Same values as assets/js/config.js (both are public).
const SUPABASE_URL = 'https://wswryravelakztdkiysq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GBV4VAh97BILvQ_ZNDoTyw_2S_x_xUu';

// YouTube's category numbers. Allowed: Howto & Style (26, where many
// tutorials are), Education (27), Science & Technology (28).
const ALLOWED_CATEGORIES = new Set(['26', '27', '28']);
const CATEGORY_NAMES = {
  1: 'Filmai ir animacija', 2: 'Automobiliai', 10: 'Muzika', 15: 'Gyvūnai', 17: 'Sportas',
  18: 'Trumpi filmai', 19: 'Kelionės ir renginiai', 20: 'Žaidimai', 22: 'Žmonės ir tinklaraščiai',
  23: 'Humoras', 24: 'Pramogos', 25: 'Naujienos ir politika', 26: 'Patarimai ir mokymai',
  27: 'Švietimas', 28: 'Mokslas ir technologijos', 29: 'Ne pelno organizacijos ir aktyvizmas',
  30: 'Filmai', 43: 'Laidos', 44: 'Anonsai',
};

const CACHE_SECONDS = 24 * 60 * 60;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// The video's id from a youtube.com or youtu.be address; null for anything
// else (other websites are not accepted).
function youtubeId(text) {
  let url;
  try {
    url = new URL(String(text).trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
      if (m) id = m[1];
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

// "PT1H2M3S" -> 3723
function seconds(duration) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration || '');
  return m ? (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) : 0;
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

// YouTube's verdict on one video: { ok: true, id, title, channel, seconds }
// or { ok: false, error, category? }. null when YouTube couldn't be asked.
async function judge(id, env) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = `https://youtube-check.mokify.invalid/v1/${id}`;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return await hit.json();
    } catch {
      // Unreadable cache: ask YouTube.
    }
  }
  let answer;
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails&id=${id}&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`);
    if (!res.ok) return null;
    answer = await res.json();
  } catch {
    return null;
  }
  const video = answer && Array.isArray(answer.items) ? answer.items[0] : null;
  let verdict;
  if (!video || !video.snippet || !video.status) {
    verdict = { ok: false, error: 'not_found' };
  } else if (!['public', 'unlisted'].includes(video.status.privacyStatus) || video.status.embeddable === false) {
    verdict = { ok: false, error: 'not_embeddable' };
  } else if (video.contentDetails && video.contentDetails.contentRating && video.contentDetails.contentRating.ytRating === 'ytAgeRestricted') {
    verdict = { ok: false, error: 'age' };
  } else if (!ALLOWED_CATEGORIES.has(String(video.snippet.categoryId))) {
    verdict = { ok: false, error: 'category', category: CATEGORY_NAMES[video.snippet.categoryId] || 'kita' };
  } else if (video.snippet.liveBroadcastContent && video.snippet.liveBroadcastContent !== 'none') {
    verdict = { ok: false, error: 'live' };
  } else {
    verdict = {
      ok: true,
      id,
      title: String(video.snippet.title || '').slice(0, 200),
      channel: String(video.snippet.channelTitle || '').slice(0, 100),
      seconds: seconds(video.contentDetails && video.contentDetails.duration),
    };
  }
  if (cache) {
    try {
      await cache.put(key, new Response(JSON.stringify(verdict), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` },
      }));
    } catch {
      // Not cached: asked again next time.
    }
  }
  return verdict;
}

export async function onRequestPost({ request, env }) {
  // Only Mokify's own pages ask.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: 'forbidden' }, 403);

  const authorization = request.headers.get('Authorization') || '';
  const login = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  let code = '';
  let link = '';
  try {
    const body = await request.json();
    if (body && typeof body.code === 'string') code = body.code;
    if (body && typeof body.url === 'string') link = body.url.slice(0, 500);
  } catch {
    // Not JSON: refused below.
  }
  if (!login || login.length > 4096 || !/^[A-Za-z0-9-]{12,20}$/.test(code)) return json({ ok: false, error: 'bad_request' }, 400);
  const id = youtubeId(link);
  if (!id) return json({ ok: false, error: 'bad_link' });

  // The database checks the login, that the school's subscription runs, that
  // the student is inside this meeting, and how often they ask
  // (meeting_video_ticket in supabase/updates/2026-12-02-meeting-videos.sql).
  let ticket = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/meeting_video_ticket`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${login}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
    });
    if (res.status === 404) return json({ ok: false, error: 'not_set_up' });
    if (res.ok) ticket = await res.json();
  } catch {
    return json({ ok: false, error: 'unavailable' }, 502);
  }
  if (!ticket || ticket.ok !== true) return json({ ok: false, error: ticket && ticket.error === 'limit' ? 'limit' : 'forbidden' }, 403);

  if (!env.YOUTUBE_API_KEY) return json({ ok: false, error: 'not_set_up' });
  const verdict = await judge(id, env);
  if (!verdict) return json({ ok: false, error: 'unavailable' }, 502);
  return json(verdict);
}

// Whether the key is set up (nothing else).
export function onRequestGet({ env }) {
  return json({ videos: Boolean(env.YOUTUBE_API_KEY) });
}

export function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
