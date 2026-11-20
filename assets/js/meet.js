// Mokify — meetings (susitikimai.html): video calls between students.
// Loaded after main.js and uses its helpers (callApi, getSession, showBanner…).
//
// How a call works:
//  * The database (supabase/updates/2026-11-13-meetings.sql) decides who is
//    inside a meeting. Every second or two this page asks it for news
//    (meeting_sync): who is inside, who asks to come in, and the technical
//    notes other browsers left for this one.
//  * Sound and picture go from browser to browser (WebRTC), one encrypted
//    connection per pair of students. They pass through a relay server, so
//    students never learn each other's network address.
//  * Names and pictures always come from the database, never from the other
//    browser. The other browser can only say things about itself: whether
//    its microphone and camera are on, and whether its hand is up.

document.addEventListener('DOMContentLoaded', initMeetings);

const MEET_PAGE = 'susitikimai.html';
// Same format as the check on public.meeting_rooms.code.
const MEET_CODE_PATTERN = /^[a-hjkmnp-z2-9]{12}$/;
// How often an open meeting asks the database for news: normally, while two
// browsers are busy connecting, and when the database can nudge this page
// itself (Supabase Realtime) so asking is only a safety net.
const MEET_SYNC_MS = 1500;
const MEET_SYNC_FAST_MS = 350;
const MEET_SYNC_NUDGED_MS = 5000;
const MEET_FAST_FOR_MS = 8000;
const MEET_CHAT_MAX_LENGTH = 1000;
const MEET_DEVICES_KEY = 'mokify.meet.devices';
// Relay passwords are handed out for two hours; fetch new ones well before.
const MEET_RELAY_FRESH_MS = 60 * 60 * 1000;
// After a lesson's time is over, the call goes on this long, then ends
// (the database does the same: supabase/updates/2026-11-22-lesson-length-points.sql).
const MEET_LESSON_GRACE_MS = 5 * 60 * 1000;

const MEET_ERRORS = {
  signed_out: 'Prisijunk iš naujo, kad galėtum tęsti.',
  inactive: 'Tavo mokyklos Mokify prenumerata pasibaigė, todėl susitikimai šiuo metu neprieinami.',
  disabled: 'Susitikimai laikinai išjungti. Pabandyk vėliau.',
  network: NETWORK_FAILED_MSG,
  limit: 'Per daug bandymų. Pabandyk vėliau.',
  not_found: 'Tokio susitikimo nėra. Patikrink kodą arba nuorodą.',
  ended: 'Šis susitikimas jau baigėsi.',
  locked: 'Organizatorius užrakino šį susitikimą, todėl naujų dalyvių nebepriima.',
  full: 'Susitikime nebėra laisvų vietų.',
  denied: 'Organizatorius tavęs neįleido.',
  removed: 'Organizatorius pašalino tave iš šio susitikimo, todėl grįžti į jį nebegali.',
  refused: 'Prie šio susitikimo prisijungti negali.',
  failed: 'Nepavyko. Pabandyk dar kartą.',
};

// What the last screen says, by why the meeting is over for this student.
// rejoin: offer a way back in.
const MEET_ENDINGS = {
  left: { title: 'Išėjai iš susitikimo', rejoin: true },
  ended: { title: 'Susitikimas baigėsi', text: 'Organizatorius jį užbaigė arba baigėsi susitikimo laikas.' },
  ended_by_me: { title: 'Susitikimas baigtas', text: 'Jo nuoroda nebeveikia.' },
  removed: { title: 'Organizatorius pašalino tave iš susitikimo', text: 'Į šį susitikimą grįžti nebegali.' },
  denied: { title: 'Organizatorius tavęs neįleido' },
  replaced: { title: 'Susitikimą atidarei kitame lange', text: 'Vienu metu susitikime gali būti tik viename lange.', rejoin: true },
  no_relay: { title: 'Susitikimai šiuo metu neveikia', text: 'Nepavyko paruošti saugaus ryšio tarp dalyvių. Pabandyk vėliau.' },
  relay_limit: { title: 'Vaizdo skambučiai laikinai neprieinami', text: 'Pasiektas šio mėnesio vaizdo skambučių limitas. Jie vėl veiks po kelių dienų.' },
  inactive: { title: 'Susitikimai neprieinami', text: MEET_ERRORS.inactive },
  disabled: { title: 'Susitikimai laikinai išjungti', text: 'Pabandyk vėliau.' },
};

const normalizeMeetingCode = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const formatMeetingCode = (code) => `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;

// The code from what a student typed or pasted: the code itself or a whole
// meeting link. null when it isn't one.
function meetingCodeFrom(text) {
  let value = String(text || '').trim();
  const fromLink = /[?&]k=([^&#\s]+)/.exec(value);
  if (fromLink) value = fromLink[1];
  const code = normalizeMeetingCode(value);
  return MEET_CODE_PATTERN.test(code) ? code : null;
}

// Calls one of the meeting_* database functions. Resolves to its answer,
// { ok: true, ... } or { ok: false, error }.
async function meetingRpc(fn, body = {}) {
  const session = await getSession();
  if (!session) return { ok: false, error: readSession() ? 'network' : 'signed_out' };
  const res = await callApi(`/rest/v1/rpc/${fn}`, { body, token: session.access_token });
  if (res.ok && res.data && typeof res.data.ok === 'boolean') return res.data;
  if (res.unconfigured || res.status === 0) return { ok: false, error: 'network' };
  if (res.status === 401) return { ok: false, error: 'signed_out' };
  if (res.status === 429) return { ok: false, error: 'limit' };
  console.error(`${fn} failed`, res.status, res.data);
  return { ok: false, error: 'failed' };
}

// Pictures come from the database, which only stores the default picture or
// a small JPEG; anything else is shown as the default.
const meetingAvatar = (avatar) => (
  typeof avatar === 'string' && (avatar === DEFAULT_AVATAR || avatar.startsWith('data:image/jpeg;base64,'))
    ? avatar
    : DEFAULT_AVATAR
);

// "9 klasė · Vilniaus Žirmūnų gimnazija"
const meetingPersonMeta = (card) => [card.grade && `${card.grade} klasė`, card.school].filter(Boolean).join(' · ');

function initMeetings() {
  const page = document.getElementById('meet');
  if (!page) return;
  const $ = (id) => document.getElementById(id);

  // The same call serves two pages: open meetings (susitikimai.html), and
  // one-on-one lessons between a teacher and a student (pamoka.html), which
  // are opened from their chat and have no codes or links to pass around.
  const lessonMode = page.dataset.kind === 'lesson';
  const lessonId = lessonMode ? (new URLSearchParams(window.location.search).get('k') || '') : '';
  let lesson = null; // lesson_open's answer: who the lesson is with.

  const loginUrl = (code) => (lessonMode
    ? `prisijungti.html?next=${encodeURIComponent(`pamoka.html${UUID_PATTERN.test(lessonId) ? `?k=${lessonId}` : ''}`)}`
    : `prisijungti.html?next=${encodeURIComponent(MEET_PAGE + (code ? `?k=${formatMeetingCode(code)}` : ''))}`);
  if (!readSession()) {
    window.location.replace(loginUrl(meetingCodeFrom(window.location.search)));
    return;
  }
  // Words that differ between the two pages.
  const WORDS = lessonMode
    ? { host: 'Mokytojas', hosts: 'Veda pamoką', title: 'Pamoka' }
    : { host: 'Organizatorius', hosts: 'Organizuoja susitikimą', title: 'Susitikimas' };
  const endings = lessonMode ? {
    ...MEET_ENDINGS,
    left: { title: 'Išėjai iš pamokos', rejoin: true },
    ended: { title: 'Pamoka baigėsi' },
    ended_by_me: { title: 'Pamoka baigta' },
    removed: { title: 'Mokytojas pašalino tave iš pamokos', text: 'Į šią pamoką grįžti nebegali.' },
    replaced: { title: 'Pamoką atidarei kitame lange', text: 'Vienu metu pamokoje gali būti tik viename lange.', rejoin: true },
    no_relay: { title: 'Pamokos šiuo metu neveikia', text: 'Nepavyko paruošti saugaus ryšio. Pabandyk vėliau.' },
    inactive: { title: 'Pamokos neprieinamos', text: 'Tavo mokyklos Mokify prenumerata pasibaigė, todėl pamokos šiuo metu neprieinamos.' },
    disabled: { title: 'Pamokos laikinai išjungtos', text: 'Pabandyk vėliau.' },
  } : MEET_ENDINGS;

  // --- What is on screen ---------------------------------------------------

  const root = document.documentElement;
  const screens = { home: $('meet-home'), lobby: $('meet-lobby'), call: $('meet-call'), done: $('meet-done') };
  // home | lobby | waiting (asked to come in) | call | done
  let phase = '';

  function setPhase(next) {
    phase = next;
    const shown = next === 'waiting' ? 'lobby' : next;
    Object.entries(screens).forEach(([name, el]) => {
      if (el) el.hidden = name !== shown;
    });
    root.classList.toggle('in-meeting', next === 'call');
  }

  // --- State of the open meeting -------------------------------------------

  let me = { id: readSession().user.id, name: '', avatar: DEFAULT_AVATAR };
  let code = null; // The open meeting.
  let conn = null; // This tab's seat in it.
  let info = null; // meeting_info's answer.
  let room = null; // The meeting as of the latest meeting_sync.
  let mySeq = 0; // Whoever came in later starts the connection between two browsers.
  let ice = null; // Relay servers for the connections.
  const peers = new Map(); // Other participants by student id.
  const cards = new Map(); // Their names and pictures, from the database.
  const cardsAsked = new Set();
  const gone = new Map(); // Tabs that said goodbye, until the database confirms it.

  const session = () => readSession();
  const isOwner = () => Boolean(room ? room.owner === me.id : info && info.mine);
  const inviteUrl = () => `${window.location.origin}${window.location.pathname}?k=${formatMeetingCode(code)}`;

  function toLogin() {
    clearSession();
    window.location.replace(loginUrl(code));
  }

  // --- Small helpers ---------------------------------------------------------

  const toastsEl = $('call-toasts');
  function toast(message, ms = 4500) {
    const el = document.createElement('p');
    el.className = 'meet-toast';
    el.textContent = message;
    toastsEl.appendChild(el);
    window.setTimeout(() => el.remove(), ms);
    while (toastsEl.children.length > 4) toastsEl.firstElementChild.remove();
  }

  // Label says what pressing the button will do next.
  function setToggle(button, on, whenOn, whenOff) {
    button.setAttribute('aria-pressed', String(on));
    const label = on ? whenOn : whenOff;
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  // A warning window with one red button; run() resolves to { ok } or { ok: false, error }.
  const confirmDialog = $('meet-confirm');
  const confirmOk = $('meet-confirm-ok');
  const confirmError = $('meet-confirm-error');
  let confirmRun = null;
  function askToConfirm({ title, text, ok, run }) {
    $('meet-confirm-title').textContent = title;
    $('meet-confirm-text').textContent = text;
    confirmOk.textContent = ok;
    showBanner(confirmError, '');
    confirmRun = run;
    confirmDialog.showModal();
  }
  confirmOk.addEventListener('click', async () => {
    if (!confirmRun) return;
    setBusy(confirmOk, true, 'Palaukite…');
    const result = await confirmRun();
    setBusy(confirmOk, false);
    if (!result.ok) {
      showBanner(confirmError, MEET_ERRORS[result.error] || MEET_ERRORS.failed);
      return;
    }
    confirmRun = null;
    confirmDialog.close();
  });

  // --- Start page ------------------------------------------------------------

  const homeError = $('meet-home-error');
  const createForm = $('meet-create-form');
  const createBtn = $('meet-create');
  const codeForm = $('meet-code-form');
  const codeInput = $('meet-code');
  const mineBox = $('meet-mine');
  const mineList = $('meet-mine-list');

  const setCodeError = (message) => {
    codeInput.closest('.field').classList.toggle('has-error', Boolean(message));
    $('meet-code-error').textContent = message;
    codeInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  };

  // Back to the start page, without reloading.
  function goHome() {
    window.history.pushState(null, '', window.location.pathname);
    route();
  }

  // A meeting opens in a tab of its own, so the page it was opened from
  // stays where it was. The tab has to be opened at the very moment of the
  // click (browsers block it otherwise) and is given its address once known.
  const meetingUrl = (meetingCode) => `${window.location.pathname}?k=${formatMeetingCode(meetingCode)}`;
  function openTab(url) {
    const tab = window.open(url || '', '_blank');
    if (tab) tab.opener = null;
    return tab;
  }
  function showInTab(tab, meetingCode) {
    if (tab && !tab.closed) {
      tab.location.replace(meetingUrl(meetingCode));
      return;
    }
    // The browser didn't allow a new tab: open it here instead.
    window.history.pushState(null, '', meetingUrl(meetingCode));
    route();
  }

  function mineItem(m) {
    const li = document.createElement('li');
    li.className = 'meet-mine-item';
    const text = document.createElement('div');
    text.className = 'meet-mine-text';
    const title = document.createElement('p');
    title.className = 'meet-mine-title';
    title.textContent = m.title || 'Susitikimas be pavadinimo';
    const meta = document.createElement('p');
    meta.className = 'meet-mine-meta text-muted';
    const inside = m.present ? `, dabar jame ${m.present} ${pluralLt(m.present, 'dalyvis', 'dalyviai', 'dalyvių')}` : '';
    meta.textContent = `Sukurtas ${formatChatTime(m.created_at)}${inside}`;
    text.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'meet-mine-actions';
    const open = document.createElement('a');
    open.className = 'btn btn-primary btn-sm';
    open.href = `${MEET_PAGE}?k=${formatMeetingCode(m.code)}`;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = 'Atidaryti';
    const end = document.createElement('button');
    end.type = 'button';
    end.className = 'link-button';
    end.textContent = 'Baigti';
    end.addEventListener('click', () => askToConfirm({
      title: 'Baigti šį susitikimą?',
      text: 'Jo nuoroda nustos veikti, o jame esantys dalyviai bus atjungti.',
      ok: 'Baigti susitikimą',
      run: async () => {
        const result = await meetingRpc('meeting_end', { p_code: m.code });
        if (result.ok) {
          li.remove();
          mineBox.hidden = !mineList.children.length;
        }
        return result;
      },
    }));
    actions.append(open, end);
    li.append(text, actions);
    return li;
  }

  async function openHome() {
    setPhase('home');
    showBanner(homeError, '');
    setCodeError('');
    const res = await meetingRpc('meeting_mine');
    if (phase !== 'home') return;
    if (!res.ok) {
      if (res.error === 'signed_out') {
        toLogin();
        return;
      }
      showBanner(homeError, MEET_ERRORS[res.error] || MEET_ERRORS.failed);
      const closed = res.error === 'inactive' || res.error === 'disabled';
      createBtn.disabled = closed;
      codeForm.querySelector('button').disabled = closed;
      return;
    }
    mineList.replaceChildren(...res.rooms.filter((m) => MEET_CODE_PATTERN.test(m.code)).map(mineItem));
    mineBox.hidden = !mineList.children.length;
  }

  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      showBanner(homeError, '');
      const tab = openTab();
      setBusy(createBtn, true, 'Kuriama…');
      const res = await meetingRpc('meeting_create', { p_title: createForm.elements.title.value });
      setBusy(createBtn, false);
      if (!res.ok || !MEET_CODE_PATTERN.test(res.code || '')) {
        if (tab) tab.close();
        if (res.error === 'signed_out') toLogin();
        else showBanner(homeError, res.error === 'limit' ? 'Per valandą galima sukurti iki 10 susitikimų. Pabandyk vėliau.' : (MEET_ERRORS[res.error] || MEET_ERRORS.failed));
        return;
      }
      createForm.reset();
      showInTab(tab, res.code);
      // The new meeting joins the list of the student's own meetings.
      if (phase === 'home') openHome();
    });

    codeInput.addEventListener('input', () => setCodeError(''));
    codeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const found = meetingCodeFrom(codeInput.value);
      if (!found) {
        setCodeError('Įvesk 12 simbolių kodą (xxxx-xxxx-xxxx) arba įklijuok susitikimo nuorodą.');
        codeInput.focus();
        return;
      }
      codeInput.value = '';
      if (!openTab(meetingUrl(found))) showInTab(null, found);
    });
  }

  // --- Camera, microphone, screen --------------------------------------------

  // mic stays open while muted (so unmuting is instant) and is only silenced;
  // the camera is switched off for real, so its light goes out.
  const media = { mic: null, cam: null, screen: null, micOn: false, camOn: false, hand: false };
  let devicePrefs = { mic: '', cam: '', speaker: '' };
  try {
    const stored = JSON.parse(localStorage.getItem(MEET_DEVICES_KEY));
    if (stored && typeof stored === 'object') {
      ['mic', 'cam', 'speaker'].forEach((key) => {
        if (typeof stored[key] === 'string') devicePrefs[key] = stored[key];
      });
    }
  } catch {
    // Storage blocked or empty: the browser's default devices are used.
  }
  const saveDevicePrefs = () => {
    try {
      localStorage.setItem(MEET_DEVICES_KEY, JSON.stringify(devicePrefs));
    } catch {
      // Storage blocked: the choice is just not remembered.
    }
  };

  const lobbyMediaError = $('lobby-media-error');
  const MEDIA_WORDS = { audio: ['mikrofono', 'Mikrofonas nerastas. Patikrink, ar jis prijungtas.', 'Mikrofonu šiuo metu naudojasi kita programa.'], video: ['kameros', 'Kamera nerasta. Patikrink, ar ji prijungta.', 'Kamera šiuo metu naudojasi kita programa.'] };

  function mediaProblem(kind, errorName) {
    const [genitive, missing, busy] = MEDIA_WORDS[kind];
    let message = `Nepavyko įjungti ${genitive}.`;
    if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
      message = `Naršyklė neleido naudoti ${genitive}. Leisk tai naršyklės adreso juostoje ir pabandyk dar kartą.`;
    } else if (errorName === 'NotFoundError' || errorName === 'OverconstrainedError') {
      message = missing;
    } else if (errorName === 'NotReadableError' || errorName === 'AbortError') {
      message = busy;
    } else if (errorName === 'unsupported') {
      message = 'Ši naršyklė nepalaiko vaizdo skambučių. Pabandyk naujausią „Chrome“, „Edge“, „Firefox“ arba „Safari“.';
    }
    if (phase === 'call') toast(message, 8000);
    else showBanner(lobbyMediaError, message);
  }

  // One track from the chosen (or default) microphone or camera. null when it
  // couldn't be opened; the student has been told why.
  async function capture(kind) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      mediaProblem(kind, 'unsupported');
      return null;
    }
    const chosen = kind === 'audio' ? devicePrefs.mic : devicePrefs.cam;
    const wanted = kind === 'audio'
      ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' };
    const open = (constraints) => navigator.mediaDevices.getUserMedia({ [kind]: constraints });
    try {
      let stream;
      try {
        stream = await open(chosen ? { ...wanted, deviceId: { exact: chosen } } : wanted);
      } catch (err) {
        // The remembered device is gone: use whatever is there now.
        if (!chosen || (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError')) throw err;
        stream = await open(wanted);
      }
      showBanner(lobbyMediaError, '');
      refreshDevices();
      return stream.getTracks()[0] || null;
    } catch (err) {
      mediaProblem(kind, err.name);
      return null;
    }
  }

  async function setMic(on) {
    if (on && !media.mic) {
      const track = await capture('audio');
      if (!track) return;
      media.mic = track;
      // Unplugged, or permission taken away in the browser.
      track.addEventListener('ended', () => {
        if (media.mic !== track) return;
        media.mic = null;
        media.micOn = false;
        localMediaChanged();
      });
    }
    if (media.mic) media.mic.enabled = on;
    media.micOn = Boolean(on && media.mic);
    localMediaChanged();
  }

  async function setCam(on) {
    if (on && !media.cam) {
      const track = await capture('video');
      if (!track) return;
      media.cam = track;
      track.addEventListener('ended', () => {
        if (media.cam !== track) return;
        media.cam = null;
        media.camOn = false;
        localMediaChanged();
      });
    } else if (!on && media.cam) {
      const track = media.cam;
      media.cam = null;
      track.stop();
    }
    media.camOn = Boolean(media.cam);
    localMediaChanged();
    applyQuality();
  }

  async function setScreen(on) {
    if (on && !media.screen) {
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 24 } }, audio: false });
      } catch (err) {
        // Closing the browser's "choose what to share" window isn't an error.
        if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') toast('Nepavyko parodyti ekrano.', 6000);
        return;
      }
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      if ('contentHint' in track) track.contentHint = 'detail';
      media.screen = track;
      // The browser's own "Stop sharing" button.
      track.addEventListener('ended', () => {
        if (media.screen !== track) return;
        media.screen = null;
        localMediaChanged();
      });
    } else if (!on && media.screen) {
      const track = media.screen;
      media.screen = null;
      track.stop();
    }
    localMediaChanged();
  }

  function stopMedia() {
    [media.mic, media.cam, media.screen].forEach((track) => {
      if (track) track.stop();
    });
    media.mic = null;
    media.cam = null;
    media.screen = null;
    media.micOn = false;
    media.camOn = false;
    media.hand = false;
    localMediaChanged();
  }

  // --- Choosing devices ------------------------------------------------------

  const devicesDialog = $('devices-dialog');
  const selMic = $('device-mic');
  const selCam = $('device-cam');
  const selSpeaker = $('device-speaker');
  const canPickSpeaker = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

  function fillDevices(select, devices, chosen, inUse, word) {
    // Before the browser was allowed to use a device it hides their names.
    const named = devices.filter((d) => d.deviceId);
    select.replaceChildren(...named.map((d, i) => new Option(d.label || `${word} ${i + 1}`, d.deviceId)));
    select.disabled = !named.length;
    if (!named.length) {
      select.append(new Option(devices.length ? 'Įjunk, kad galėtum pasirinkti' : 'Nerasta', ''));
      return;
    }
    const current = [chosen, inUse].find((id) => id && named.some((d) => d.deviceId === id));
    if (current) select.value = current;
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    let list;
    try {
      list = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return;
    }
    const inUse = (track) => (track && track.getSettings ? track.getSettings().deviceId : '');
    fillDevices(selMic, list.filter((d) => d.kind === 'audioinput'), devicePrefs.mic, inUse(media.mic), 'Mikrofonas');
    fillDevices(selCam, list.filter((d) => d.kind === 'videoinput'), devicePrefs.cam, inUse(media.cam), 'Kamera');
    const speakers = list.filter((d) => d.kind === 'audiooutput' && d.deviceId);
    $('device-speaker-field').hidden = !(canPickSpeaker && speakers.length);
    fillDevices(selSpeaker, speakers, devicePrefs.speaker, '', 'Garsiakalbis');
  }

  function applySpeaker() {
    if (!canPickSpeaker) return;
    peers.forEach((peer) => {
      peer.audio.setSinkId(devicePrefs.speaker || '').catch(() => {});
    });
  }

  selMic.addEventListener('change', async () => {
    devicePrefs.mic = selMic.value;
    saveDevicePrefs();
    if (!media.mic) return;
    const wasOn = media.micOn;
    const old = media.mic;
    media.mic = null;
    old.stop();
    await setMic(wasOn);
    // Stays muted, but on the newly chosen microphone next time.
    if (!wasOn) localMediaChanged();
  });
  selCam.addEventListener('change', async () => {
    devicePrefs.cam = selCam.value;
    saveDevicePrefs();
    if (!media.camOn) return;
    await setCam(false);
    await setCam(true);
  });
  selSpeaker.addEventListener('change', () => {
    devicePrefs.speaker = selSpeaker.value;
    saveDevicePrefs();
    applySpeaker();
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  }
  const openDevices = () => {
    showBanner($('devices-error'), '');
    refreshDevices();
    devicesDialog.showModal();
  };
  $('lobby-settings').addEventListener('click', openDevices);
  $('call-settings').addEventListener('click', openDevices);

  // --- Who is talking: marks the picture of whoever is speaking --------------

  let audioContext = null;
  const meters = new Map(); // key -> { source, analyser, samples, until, on }
  let meterTimer = null;

  function watchVoice(key, track, onChange) {
    unwatchVoice(key);
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!track || !AudioContextClass) return;
    try {
      audioContext = audioContext || new AudioContextClass();
      const source = audioContext.createMediaStreamSource(new MediaStream([track]));
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      meters.set(key, { source, analyser, samples: new Uint8Array(analyser.fftSize), until: 0, on: false, onChange });
    } catch {
      return;
    }
    if (!meterTimer) meterTimer = window.setInterval(readMeters, 160);
  }

  function unwatchVoice(key) {
    const meter = meters.get(key);
    if (!meter) return;
    try {
      meter.source.disconnect();
    } catch {
      // Already gone.
    }
    if (meter.on) meter.onChange(false);
    meters.delete(key);
  }

  function readMeters() {
    const now = Date.now();
    meters.forEach((meter) => {
      meter.analyser.getByteTimeDomainData(meter.samples);
      let sum = 0;
      for (let i = 0; i < meter.samples.length; i += 1) {
        const v = (meter.samples[i] - 128) / 128;
        sum += v * v;
      }
      if (Math.sqrt(sum / meter.samples.length) > 0.035) meter.until = now + 700;
      const on = now < meter.until;
      if (on !== meter.on) {
        meter.on = on;
        meter.onChange(on);
      }
    });
  }

  function stopMeters() {
    [...meters.keys()].forEach(unwatchVoice);
    dropSoundMeter();
    window.clearInterval(meterTimer);
    meterTimer = null;
    if (audioContext) audioContext.close().catch(() => {});
    audioContext = null;
  }

  // A short two-note chime when someone asks to come in.
  function chime() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      audioContext = audioContext || new AudioContextClass();
      const start = audioContext.currentTime;
      [[660, 0], [880, 0.16]].forEach(([frequency, at]) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start + at);
        gain.gain.exponentialRampToValueAtTime(0.12, start + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.3);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(start + at);
        osc.stop(start + at + 0.32);
      });
    } catch {
      // No sound; the request still shows on screen.
    }
  }

  // --- Pictures on screen ----------------------------------------------------

  const tileTemplate = $('tpl-tile');
  const gridEl = $('call-grid');
  const spotEl = $('call-spot');
  const inviteEl = $('call-invite');
  let selfTile = null;
  let spotTile = null; // The picture shown large, if any.

  function makeTile({ self = false, screen = false } = {}) {
    const el = tileTemplate.content.firstElementChild.cloneNode(true);
    const tile = {
      el,
      video: el.querySelector('video'),
      img: el.querySelector('img'),
      name: el.querySelector('.meet-tile-name'),
      status: el.querySelector('.meet-tile-status'),
      hand: el.querySelector('.meet-tile-hand'),
      pin: el.querySelector('.meet-tile-pin'),
      track: null,
    };
    if (self) el.classList.add('is-self');
    if (screen) el.classList.add('meet-tile--screen');
    tile.pin.addEventListener('click', () => {
      spotTile = spotTile === tile ? null : tile;
      layout();
    });
    return tile;
  }

  // Shows a camera or screen track in a picture (or the paper with the
  // profile picture when there is none, or it's hidden).
  function setTileVideo(tile, track, visible) {
    if (tile.track !== track) {
      tile.track = track;
      tile.video.srcObject = track ? new MediaStream([track]) : null;
    }
    const show = Boolean(track) && visible;
    tile.video.hidden = !show;
    tile.el.classList.toggle('has-video', show);
    if (show) tile.video.play().catch(() => {});
  }

  function setTileStatus(tile, text) {
    tile.status.textContent = text;
    tile.status.hidden = !text;
  }

  // Puts `wanted` into `parent` in that order, touching only what changed
  // (moving a playing video around makes it blink).
  function syncChildren(parent, wanted) {
    [...parent.children].forEach((child) => {
      if (!wanted.includes(child)) child.remove();
    });
    wanted.forEach((el, i) => {
      if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null);
    });
  }

  function layout() {
    if (phase !== 'call' || !selfTile) return;
    const tiles = [];
    [...peers.values()].sort((a, b) => a.seq - b.seq).forEach((peer) => {
      if (peer.screenTile) tiles.push(peer.screenTile);
      tiles.push(peer.tile);
    });
    tiles.push(selfTile);
    if (spotTile && !tiles.includes(spotTile)) spotTile = null;

    // With the whiteboard open it takes the large place, and every picture
    // goes into the row below it.
    // (Same for a video watched together.)
    const shared = boardOpen || videoOpen;
    const big = shared ? null : spotTile;
    syncChildren(spotEl, big ? [big.el] : []);
    syncChildren(gridEl, tiles.filter((tile) => tile !== big).map((tile) => tile.el));
    spotEl.hidden = !big;
    gridEl.classList.toggle('is-strip', Boolean(big) || shared);
    if (boardEl) boardEl.hidden = !boardOpen;
    if (videoEl) videoEl.hidden = !videoOpen;
    tiles.forEach((tile) => {
      setToggle(tile.pin, tile === spotTile, 'Sumažinti', 'Padidinti');
      // Alone, the one picture already fills the screen.
      tile.pin.hidden = tiles.length < 2;
      if (!tile.video.hidden) tile.video.play().catch(() => {});
    });
    // (With the board open the invitation would squeeze it; the link stays
    // in the top bar.)
    inviteEl.hidden = peers.size > 0 || shared;
    measure();
  }

  // Makes the pictures as large as fits, all the same size: wide (16:9) on a
  // wide screen; on an upright phone screen squarer ones use the room better.
  function measure() {
    if (phase !== 'call') return;
    if (boardOpen) {
      boardResize();
      return;
    }
    if (videoOpen) {
      videoResize();
      return;
    }
    if (spotTile) {
      const width = Math.min(spotEl.clientWidth - 10, (spotEl.clientHeight - 10) * (16 / 9));
      spotEl.style.setProperty('--spot-w', `${Math.max(160, Math.floor(width))}px`);
      return;
    }
    const count = gridEl.children.length;
    if (!count) return;
    const gap = 16;
    const width = gridEl.clientWidth - 8;
    const height = gridEl.clientHeight - 8;
    let best = { area: 0, width: 0, shape: '16 / 9' };
    const shapes = height > width ? [['16 / 9', 16 / 9], ['4 / 3', 4 / 3], ['1 / 1', 1]] : [['16 / 9', 16 / 9]];
    shapes.forEach(([shape, ratio]) => {
      for (let cols = 1; cols <= count; cols += 1) {
        const rows = Math.ceil(count / cols);
        const w = Math.min((width - gap * (cols - 1)) / cols, ((height - gap * (rows - 1)) / rows) * ratio);
        // A squarer shape has to be clearly bigger to be worth the cropping.
        if (w > 0 && (w * w) / ratio > best.area * 1.05) best = { area: (w * w) / ratio, width: w, shape };
      }
    });
    gridEl.style.setProperty('--tile-w', `${Math.max(140, Math.floor(best.width))}px`);
    gridEl.style.setProperty('--tile-shape', best.shape);
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe($('call-stage'));
  window.addEventListener('resize', measure);

  // --- Your own controls -----------------------------------------------------

  const lobbyMic = $('lobby-mic');
  const lobbyCam = $('lobby-cam');
  const lobbyVideo = $('lobby-video');
  const lobbyTile = $('lobby-tile');
  const callMic = $('call-mic');
  const callCam = $('call-cam');
  const callScreen = $('call-screen');
  const callHand = $('call-hand');
  const sharingNotice = $('call-sharing');
  let lobbyTrack = null;

  callScreen.hidden = !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  // Called after anything about this student's own microphone, camera,
  // screen or hand changed: updates the buttons and pictures, hands the
  // tracks to every connection and tells the others.
  function localMediaChanged() {
    [lobbyMic, callMic].forEach((b) => setToggle(b, media.micOn, 'Išjungti mikrofoną', 'Įjungti mikrofoną'));
    [lobbyCam, callCam].forEach((b) => setToggle(b, media.camOn, 'Išjungti kamerą', 'Įjungti kamerą'));
    setToggle(callScreen, Boolean(media.screen), 'Neberodyti ekrano', 'Rodyti ekraną');
    setToggle(callHand, media.hand, 'Nuleisti ranką', 'Pakelti ranką');
    sharingNotice.hidden = !media.screen;

    if (lobbyTrack !== media.cam) {
      lobbyTrack = media.cam;
      lobbyVideo.srcObject = media.cam ? new MediaStream([media.cam]) : null;
    }
    lobbyVideo.hidden = !media.cam;
    lobbyTile.classList.toggle('has-video', Boolean(media.cam));

    if (selfTile) {
      setTileVideo(selfTile, media.cam, true);
      selfTile.el.classList.toggle('is-muted', !media.micOn);
      selfTile.hand.hidden = !media.hand;
    }
    if (phase === 'call') {
      if (media.micOn) watchVoice('me', media.mic, (on) => selfTile && selfTile.el.classList.toggle('is-speaking', on && media.micOn));
      else unwatchVoice('me');
      peers.forEach((peer) => {
        attachLocalTracks(peer);
        sendState(peer);
      });
      renderPeople();
    }
  }

  const busyToggle = (button, run) => button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await run();
    } finally {
      button.disabled = false;
    }
  });
  [lobbyMic, callMic].forEach((b) => busyToggle(b, () => setMic(!media.micOn)));
  [lobbyCam, callCam].forEach((b) => busyToggle(b, () => setCam(!media.camOn)));
  busyToggle(callScreen, () => setScreen(!media.screen));
  $('call-sharing-stop').addEventListener('click', () => setScreen(false));
  callHand.addEventListener('click', () => {
    media.hand = !media.hand;
    localMediaChanged();
  });

  // Fewer people: sharper picture. More people: smaller, so every browser
  // and connection keeps up. (Two people at 720p use about 1.1 GB of the
  // relay's free monthly data an hour; see functions/api/ice.js.)
  function qualityLevel() {
    const count = peers.size + 1;
    if (count <= 2) return { width: 1280, height: 720, fps: 24, kbps: 1200 };
    if (count <= 4) return { width: 640, height: 360, fps: 24, kbps: 500 };
    return { width: 480, height: 270, fps: 20, kbps: 300 };
  }

  async function limitBitrate(peer, index, kbps) {
    const transceiver = peer.pc && peer.pc.getTransceivers()[index];
    if (!transceiver) return;
    try {
      const params = transceiver.sender.getParameters();
      if (!params.encodings || !params.encodings.length) return;
      if (params.encodings[0].maxBitrate === kbps * 1000) return;
      params.encodings[0].maxBitrate = kbps * 1000;
      await transceiver.sender.setParameters(params);
    } catch {
      // The connection changed meanwhile; it is applied again next time.
    }
  }

  function applyQuality() {
    if (phase !== 'call') return;
    const level = qualityLevel();
    if (media.cam) {
      media.cam.applyConstraints({
        width: { ideal: level.width }, height: { ideal: level.height }, frameRate: { ideal: level.fps, max: 30 },
      }).catch(() => {});
    }
    peers.forEach((peer) => {
      limitBitrate(peer, 1, level.kbps);
      limitBitrate(peer, 2, 1500);
    });
  }

  // --- Before coming in ------------------------------------------------------

  const lobbyTitle = $('lobby-title');
  const lobbyHost = $('lobby-host');
  const lobbyStatus = $('lobby-status');
  const lobbyError = $('lobby-error');
  const lobbyJoin = $('lobby-join');
  const lobbyCancel = $('lobby-cancel');
  const lobbyBack = $('lobby-back');

  async function openLobby(nextCode) {
    code = nextCode;
    conn = randomId();
    info = null;
    room = null;
    setPhase('lobby');
    lobbyTitle.textContent = 'Kraunama…';
    lobbyHost.hidden = true;
    lobbyStatus.hidden = true;
    lobbyJoin.hidden = true;
    lobbyCancel.hidden = true;
    lobbyBack.hidden = false;
    showBanner(lobbyError, '');
    showBanner(lobbyMediaError, '');
    $('lobby-avatar').src = me.avatar;

    const res = await meetingRpc('meeting_info', { p_code: nextCode });
    if (phase !== 'lobby' || code !== nextCode) return;
    if (!res.ok) {
      if (res.error === 'signed_out') {
        toLogin();
        return;
      }
      lobbyTitle.textContent = 'Prisijungti nepavyko';
      showBanner(lobbyError, MEET_ERRORS[res.error] || MEET_ERRORS.failed);
      return;
    }

    info = res;
    if (lessonMode && lesson) {
      // A lesson is named after the other student, whichever of the two leads it.
      info.title = `Pamoka su ${lesson.partner.name}`;
      lobbyTitle.textContent = 'Pamoka';
      $('lobby-host-avatar').src = meetingAvatar(lesson.partner.avatar);
      $('lobby-host-name').textContent = lesson.partner.name;
      $('lobby-host-meta').textContent = lesson.i_teach ? 'Šią pamoką vedi tu' : 'Veda pamoką';
      lobbyHost.hidden = false;
    } else {
      lobbyTitle.textContent = res.title || 'Susitikimas';
      if (res.owner) {
        $('lobby-host-avatar').src = meetingAvatar(res.owner.avatar);
        $('lobby-host-name').textContent = res.mine ? 'Šį susitikimą organizuoji tu' : `Organizuoja ${res.owner.name}`;
        $('lobby-host-meta').textContent = res.mine ? '' : meetingPersonMeta(res.owner);
        lobbyHost.hidden = false;
      }
    }
    lobbyTitle.focus();

    const problem = res.ended ? 'ended' : res.status === 'removed' ? 'removed' : null;
    if (problem) {
      showBanner(lobbyError, MEET_ERRORS[problem]);
      return;
    }
    // The organizer, and anyone they already let in, walks straight in.
    // So do both students of a lesson.
    const walksIn = lessonMode || res.mine || (res.was_inside && (res.status === 'admitted' || res.status === 'left'));
    if (!walksIn && res.locked) {
      showBanner(lobbyError, MEET_ERRORS.locked);
      return;
    }
    lobbyJoin.textContent = walksIn ? 'Prisijungti' : 'Prašyti prisijungti';
    lobbyJoin.hidden = false;
  }

  lobbyJoin.addEventListener('click', async () => {
    showBanner(lobbyError, '');
    setBusy(lobbyJoin, true, 'Jungiamasi…');
    const res = await meetingRpc('meeting_join', { p_code: code, p_conn: conn });
    setBusy(lobbyJoin, false);
    if (phase !== 'lobby') return;
    if (!res.ok) {
      if (res.error === 'signed_out') {
        toLogin();
        return;
      }
      showBanner(lobbyError, MEET_ERRORS[res.error] || MEET_ERRORS.failed);
      // Asking again wouldn't change these answers.
      if (['ended', 'removed', 'denied', 'refused', 'locked', 'not_found', 'inactive', 'disabled'].includes(res.error)) lobbyJoin.hidden = true;
      return;
    }
    mySeq = res.seq;
    startSync();
    if (res.status === 'admitted') {
      enterCall();
      return;
    }
    setPhase('waiting');
    lobbyJoin.hidden = true;
    lobbyBack.hidden = true;
    lobbyCancel.hidden = false;
    lobbyStatus.textContent = 'Prašymas išsiųstas. Lauk, kol organizatorius tave įleis.';
    lobbyStatus.hidden = false;
  });

  lobbyCancel.addEventListener('click', async () => {
    stopSync();
    setBusy(lobbyCancel, true, 'Atšaukiama…');
    await meetingRpc('meeting_leave', { p_code: code, p_conn: conn });
    setBusy(lobbyCancel, false);
    if (phase !== 'waiting') return;
    conn = randomId();
    setPhase('lobby');
    lobbyStatus.hidden = true;
    lobbyCancel.hidden = true;
    lobbyBack.hidden = false;
    lobbyJoin.hidden = false;
  });

  // --- Relay servers ---------------------------------------------------------

  const isLocalDev = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  // The relay servers this student's calls go through, from the website's
  // own server (functions/api/ice.js), which checks with the database that
  // they are inside this meeting. With a relay, the other students' browsers
  // only ever see the relay's address, never this student's own.
  //
  // null when there is no relay: the call then doesn't start at all, rather
  // than quietly connecting browsers directly. (Only on a developer's own
  // computer, where there is no such server, are direct connections used.)
  let relayLimitReached = false;
  async function loadRelay() {
    try {
      // The login is renewed first if it is about to run out.
      const current = (await getSession()) || session();
      const res = await fetch('/api/ice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current ? current.access_token : ''}` },
        body: JSON.stringify({ code }),
      });
      const data = res.ok ? await res.json() : null;
      relayLimitReached = Boolean(data && data.limit === true);
      const servers = data && data.relay === true && Array.isArray(data.iceServers)
        ? data.iceServers.map((server) => ({
          urls: [].concat(server && server.urls).filter((url) => typeof url === 'string' && /^turns?:/.test(url)),
          username: server && server.username,
          credential: server && server.credential,
        })).filter((server) => server.urls.length && typeof server.username === 'string' && typeof server.credential === 'string')
        : [];
      if (servers.length) return { iceServers: servers, iceTransportPolicy: 'relay', at: Date.now() };
    } catch {
      // No answer: handled below.
    }
    return isLocalDev ? { iceServers: [], iceTransportPolicy: 'all', at: Date.now() } : null;
  }

  // --- The call --------------------------------------------------------------

  const callTitle = $('call-title');
  const lockBox = $('call-lock');
  const offlineNotice = $('call-offline');
  const soundNotice = $('call-sound');
  let wakeLock = null;

  async function keepScreenOn() {
    try {
      if (navigator.wakeLock && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Not allowed right now (e.g. low battery): the screen may dim.
    }
  }

  async function enterCall() {
    setPhase('call');
    callTitle.textContent = (info && info.title) || WORDS.title;
    if (lessonMode) $('call-invite-text').textContent = lesson ? `Kol kas čia esi tik tu. ${lesson.partner.name} dar neprisijungė.` : 'Kol kas čia esi tik tu.';
    else {
      $('call-invite-link').textContent = inviteUrl();
      $('call-invite-code').textContent = `Kodas: ${formatMeetingCode(code)}`;
    }
    offlineNotice.hidden = true;
    soundNotice.hidden = true;
    selfTile = makeTile({ self: true });
    selfTile.name.textContent = 'Tu';
    selfTile.img.src = me.avatar;
    setPanel(null);
    localMediaChanged();
    layout();
    keepScreenOn();
    callTitle.focus();

    ice = await loadRelay();
    if (phase !== 'call') return;
    if (!ice) {
      finish(relayLimitReached ? 'relay_limit' : 'no_relay', { tellServer: true });
      return;
    }
    syncSoon(0);
  }

  // --- Asking the database for news ------------------------------------------

  let syncOn = false;
  let syncTimer = null;
  let syncBusy = false;
  let syncAgain = false;
  let syncFails = 0;
  let fastUntil = 0;
  let unacked = []; // Notes that arrived and were dealt with; told to the database next time.
  let seenSignals = new Set();
  let lastChatId = 0;

  function startSync() {
    syncOn = true;
    syncFails = 0;
    unacked = [];
    seenSignals = new Set();
    lastChatId = 0;
    nudges.start();
    syncSoon(0);
  }
  function stopSync() {
    syncOn = false;
    window.clearTimeout(syncTimer);
    syncTimer = null;
    nudges.stop();
  }
  function syncSoon(ms) {
    if (!syncOn) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(sync, ms);
  }
  // Two browsers are exchanging notes: check often for a few seconds.
  const hurry = () => {
    fastUntil = Date.now() + MEET_FAST_FOR_MS;
  };
  function syncDelay() {
    if (syncFails) return Math.min(500 * 2 ** Math.min(syncFails, 4), 8000);
    if (Date.now() < fastUntil) return MEET_SYNC_FAST_MS;
    return nudges.live ? MEET_SYNC_NUDGED_MS : MEET_SYNC_MS;
  }

  async function sync() {
    if (!syncOn) return;
    if (syncBusy) {
      syncAgain = true;
      return;
    }
    syncBusy = true;
    syncAgain = false;
    const forCode = code;
    const forConn = conn;
    const acked = unacked.slice();
    const res = await meetingRpc('meeting_sync', { p_code: code, p_conn: conn, p_ack: acked, p_chat_after: lastChatId });
    syncBusy = false;
    if (!syncOn) return;
    if (code !== forCode || conn !== forConn) {
      // An answer for a seat this tab no longer holds (it left and came in
      // again meanwhile): ask afresh.
      syncSoon(0);
      return;
    }

    if (res.ok) {
      syncFails = 0;
      offlineNotice.hidden = true;
      unacked = unacked.filter((id) => !acked.includes(id));
      handleSync(res);
    } else if (res.error === 'signed_out') {
      await finish('left', { silent: true });
      toLogin();
      return;
    } else if (res.error === 'inactive' || res.error === 'disabled') {
      finish(res.error);
      return;
    } else {
      // No connection, or the server is busy: keep trying, slower each time.
      syncFails += 1;
      if (syncFails >= 3 && phase === 'call') offlineNotice.hidden = false;
    }
    if (syncOn) syncSoon(syncAgain ? 0 : syncDelay());
  }

  function handleSync(res) {
    if (res.status === 'waiting') return;
    if (res.status !== 'admitted') {
      // denied, removed, ended, replaced, left, gone
      if (lessonMode && res.status === 'ended') {
        stopSync();
        lessonEnded();
        return;
      }
      finish(endings[res.status] ? res.status : 'ended');
      return;
    }
    if (phase === 'waiting') {
      mySeq = res.seq;
      enterCall();
    }
    if (phase !== 'call') return;
    if (typeof res.seq === 'number' && res.seq !== mySeq) {
      // This tab came in again: every connection starts over.
      mySeq = res.seq;
      [...peers.values()].forEach(removePeer);
    }
    room = res.room || room;
    // (Not while the organizer's own change to the lock is on its way. A
    // lesson has no lock: nobody else can come in anyway.)
    if (lockBox) {
      if (!lockBox.disabled) lockBox.checked = Boolean(room && room.locked);
      $('panel-host').hidden = !isOwner();
    }
    // Connections wait until the relay servers are known; the notes for
    // them stay in the database until then.
    if (ice) {
      reconcilePeers(Array.isArray(res.people) ? res.people : []);
      readSignals(Array.isArray(res.signals) ? res.signals : []);
    }
    renderKnocks(isOwner() && Array.isArray(res.waiting) ? res.waiting : []);
    appendChat(Array.isArray(res.chat) ? res.chat : []);
  }

  // --- Supabase Realtime: the database nudges this page when there is news ---
  //
  // Only a speed-up. Each student listens on a channel of their own
  // (meeting:<their id>) that only they may listen to and nobody may send to;
  // the database functions send "nudge" into it. A nudge carries no
  // information: this page just asks the database for news right away
  // instead of a second later. If the connection can't be made, everything
  // works as before.
  const nudges = {
    live: false,
    socket: null,
    wanted: false,
    token: null,
    joinRef: null,
    ref: 0,
    fails: 0,
    beat: null,
    retry: null,
    lastNudge: 0,

    start() {
      this.wanted = true;
      this.fails = 0;
      this.open();
    },

    stop() {
      this.wanted = false;
      this.close();
    },

    close() {
      this.live = false;
      window.clearInterval(this.beat);
      window.clearTimeout(this.retry);
      const socket = this.socket;
      this.socket = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try {
          socket.close();
        } catch {
          // Already closed.
        }
      }
    },

    // Phoenix channel framing: every message is numbered, and messages
    // about a joined channel carry the number its join had.
    send(socket, topic, event, payload, joinRef) {
      this.ref += 1;
      const ref = String(this.ref);
      socket.send(JSON.stringify({ topic, event, payload, ref, join_ref: joinRef === 'self' ? ref : (joinRef || null) }));
      return ref;
    },

    open() {
      const { supabaseUrl, supabaseKey } = backendConfig();
      const current = session();
      if (!this.wanted || !supabaseUrl || !supabaseKey || !current || typeof WebSocket === 'undefined') return;
      this.close();
      const topic = `realtime:meeting:${me.id}`;
      let socket;
      try {
        socket = new WebSocket(`${supabaseUrl.replace(/\/$/, '').replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(supabaseKey)}&vsn=1.0.0`);
      } catch {
        return;
      }
      this.socket = socket;
      const again = () => {
        if (this.socket !== socket) return;
        this.close();
        this.fails += 1;
        // After a few failures in a row, stop trying for this meeting.
        if (this.wanted && this.fails <= 6) this.retry = window.setTimeout(() => this.open(), Math.min(1000 * 2 ** this.fails, 30000));
      };
      socket.onopen = () => {
        this.token = current.access_token;
        this.joinRef = this.send(socket, topic, 'phx_join', {
          config: { broadcast: { ack: false, self: false }, presence: { enabled: false }, postgres_changes: [], private: true },
          access_token: current.access_token,
        }, 'self');
        this.beat = window.setInterval(() => {
          if (socket.readyState === 1) this.send(socket, 'phoenix', 'heartbeat', {});
        }, 25000);
      };
      socket.onmessage = (e) => {
        let message;
        try {
          message = JSON.parse(e.data);
        } catch {
          return;
        }
        if (!message || message.topic !== topic) return;
        if (message.event === 'phx_reply' && message.ref === this.joinRef) {
          if (message.payload && message.payload.status === 'ok') {
            this.live = true;
            this.fails = 0;
          } else {
            again();
          }
        } else if (message.event === 'broadcast') {
          // At most a few a second, whatever arrives.
          if (Date.now() - this.lastNudge < 150) return;
          this.lastNudge = Date.now();
          syncSoon(0);
        } else if (message.event === 'phx_close' || message.event === 'phx_error') {
          again();
        }
      };
      socket.onclose = again;
      socket.onerror = again;
    },

    // Logins are renewed every hour; the channel must be told the new one.
    refresh() {
      const current = session();
      if (!this.live || !this.socket || !current || current.access_token === this.token) return;
      this.token = current.access_token;
      try {
        this.send(this.socket, `realtime:meeting:${me.id}`, 'access_token', { access_token: current.access_token }, this.joinRef);
      } catch {
        // The socket is closing; it reconnects with the new login.
      }
    },
  };

  // --- Connections to the other participants ---------------------------------
  //
  // One RTCPeerConnection per other participant. Whoever came in later
  // (higher seq) starts it; the other side only ever answers, so the two
  // never talk over each other. Every connection has three fixed lines
  // (microphone, camera, screen) plus a small data channel, so switching a
  // camera on or off later needs no new negotiation.

  let outbox = [];
  let outboxTimer = null;
  let outboxBusy = false;
  let outboxFails = 0;

  function queueSignal(peer, kind, data) {
    outbox.push({ to: peer.id, to_conn: peer.conn, kind, data });
    hurry();
    // Offers and answers go at once; network addresses are bundled.
    if (kind !== 'ice') {
      window.clearTimeout(outboxTimer);
      outboxTimer = window.setTimeout(flushSignals, 0);
    } else if (!outboxTimer) {
      outboxTimer = window.setTimeout(flushSignals, 120);
    }
  }

  async function flushSignals() {
    outboxTimer = null;
    if (outboxBusy || !outbox.length || phase !== 'call') return;
    outboxBusy = true;
    const batch = outbox.splice(0, 50);
    const res = await meetingRpc('meeting_signal', { p_code: code, p_conn: conn, p_messages: batch });
    outboxBusy = false;
    if (phase !== 'call') return;
    if (!res.ok && (res.error === 'network' || res.error === 'failed') && outboxFails < 3) {
      // Try the same notes again shortly; after that the connection attempt
      // times out and starts over by itself.
      outboxFails += 1;
      outbox = batch.concat(outbox);
      outboxTimer = window.setTimeout(flushSignals, 600 * outboxFails);
      return;
    }
    outboxFails = 0;
    if (outbox.length) flushSignals();
    syncSoon(MEET_SYNC_FAST_MS);
  }

  function readSignals(signals) {
    signals.forEach((signal) => {
      if (!signal || typeof signal.id !== 'number' || seenSignals.has(signal.id)) return;
      seenSignals.add(signal.id);
      unacked.push(signal.id);
      if (!signal.data || typeof signal.data !== 'object') return;
      // The database only lets the organizer send these.
      if (signal.kind === 'ctl') {
        if (room && signal.from === room.owner) organizerAsked(signal.data.action);
        return;
      }
      const peer = peers.get(signal.from);
      if (!peer || peer.conn !== signal.conn) return;
      hurry();
      // One at a time per participant, in the order they were sent.
      peer.chain = peer.chain
        .then(() => (peers.get(peer.id) === peer ? handleSignal(peer, signal.kind, signal.data) : null))
        .catch((err) => console.error('Meeting signal failed', err));
    });
    if (seenSignals.size > 4000) seenSignals = new Set([...seenSignals].slice(-2000));
  }

  function organizerAsked(action) {
    if (action === 'mute' && media.micOn) {
      setMic(false);
      toast(`${WORDS.host} išjungė tavo mikrofoną.`);
    } else if (action === 'cam_off' && media.camOn) {
      setCam(false);
      toast(`${WORDS.host} išjungė tavo kamerą.`);
    } else if (action === 'share_off' && media.screen) {
      setScreen(false);
      toast(`${WORDS.host} sustabdė tavo ekrano rodymą.`);
    }
  }

  function reconcilePeers(people) {
    const present = new Map();
    people.forEach((p) => {
      if (!p || !UUID_PATTERN.test(p.id || '') || !UUID_PATTERN.test(p.conn || '') || typeof p.seq !== 'number' || p.id === me.id) return;
      // Said goodbye a moment ago; the database just hasn't noticed yet. If
      // it still lists them a few seconds later they are in fact still
      // here, and they are shown again: the database decides who is inside,
      // not what a browser says.
      const bye = gone.get(p.id);
      if (bye && bye.conn === p.conn && Date.now() - bye.at < 6000) return;
      present.set(p.id, p);
    });
    gone.forEach((bye, id) => {
      const now = people.find((p) => p && p.id === id);
      if (!now || now.conn !== bye.conn || Date.now() - bye.at >= 6000) gone.delete(id);
    });

    let changed = false;
    [...peers.values()].forEach((peer) => {
      const now = present.get(peer.id);
      if (now && now.conn === peer.conn && now.seq === peer.seq) return;
      removePeer(peer);
      changed = true;
    });
    present.forEach((p) => {
      if (peers.has(p.id)) return;
      addPeer(p);
      changed = true;
    });
    loadCards([...present.keys()]);
    if (!changed) return;
    layout();
    applyQuality();
    renderPeople();
  }

  function addPeer({ id, conn: peerConn, seq }) {
    // The other student of a lesson has come: nobody is late any more.
    if (lessonMode && lesson && lesson.partner.id === id) lesson.partnerJoined = true;
    const peer = {
      id,
      conn: peerConn,
      seq,
      starts: mySeq > seq, // This side starts the connection.
      pc: null,
      channel: null,
      sid: null, // Names one connection attempt; notes for an older one are ignored.
      remoteSet: false,
      candidates: [],
      chain: Promise.resolve(),
      attempts: 0,
      restarts: 0,
      timer: null,
      messages: 0,
      messagesAt: 0,
      // What their browser says about itself.
      says: { mic: false, cam: false, screen: false, hand: false },
      tracks: { mic: null, cam: null, screen: null },
      mutedByMe: false,
      hiddenByMe: false,
      tile: makeTile(),
      screenTile: null,
      audio: new Audio(),
    };
    peer.audio.autoplay = true;
    if (canPickSpeaker && devicePrefs.speaker) peer.audio.setSinkId(devicePrefs.speaker).catch(() => {});
    peers.set(id, peer);
    renderPeer(peer);
    setTileStatus(peer.tile, 'Jungiamasi…');
    if (peer.starts) startPeer(peer);
    // Otherwise their offer arrives within a moment.
  }

  function removePeer(peer) {
    if (peers.get(peer.id) !== peer) return;
    closeConnection(peer);
    peers.delete(peer.id);
    unwatchVoice(peer.id);
    peer.audio.srcObject = null;
    peer.tile.el.remove();
    if (peer.screenTile) peer.screenTile.el.remove();
    if (reportTarget === peer.id && !reportDialog.open) reportTarget = null;
  }

  function closeConnection(peer) {
    window.clearTimeout(peer.timer);
    peer.timer = null;
    const { pc, channel, board } = peer;
    peer.pc = null;
    peer.channel = null;
    peer.board = null;
    window.clearTimeout(peer.boardPump);
    peer.boardPump = 0;
    peer.boardOut = [];
    if (board) {
      board.onopen = null;
      board.onmessage = null;
      try {
        board.close();
      } catch {
        // Already closed.
      }
    }
    peer.remoteSet = false;
    peer.candidates = [];
    if (channel) {
      channel.onopen = null;
      channel.onmessage = null;
      try {
        channel.close();
      } catch {
        // Already closed.
      }
    }
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Already closed.
      }
    }
    peer.tracks = { mic: null, cam: null, screen: null };
    peer.says = { mic: false, cam: false, screen: false, hand: false };
    unwatchVoice(peer.id);
    renderPeer(peer);
  }

  function openConnection(peer, sid) {
    closeConnection(peer);
    const pc = new RTCPeerConnection({
      iceServers: ice.iceServers,
      iceTransportPolicy: ice.iceTransportPolicy,
      bundlePolicy: 'max-bundle',
    });
    peer.pc = pc;
    peer.sid = sid;
    // The starting side lays out the three lines: microphone, camera, screen.
    // The other side gets the same three from the offer.
    if (peer.starts) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }
    // Both sides open channel 0 themselves, so it needs no negotiation.
    const channel = pc.createDataChannel('mokify', { negotiated: true, id: 0 });
    peer.channel = channel;
    channel.onopen = () => sendState(peer);
    channel.onmessage = (e) => peerSaid(peer, e.data);
    // The whiteboard's own channel (1), so drawing never gets in the way of
    // the call's messages; when it opens, the newcomer gets the whole board.
    const board = pc.createDataChannel('board', { negotiated: true, id: 1 });
    peer.board = board;
    peer.boardOut = [];
    board.onopen = () => boardSendAll(peer);
    board.onmessage = (e) => boardSaid(peer, e.data);
    pc.onicecandidate = (e) => {
      if (e.candidate && peer.pc === pc) queueSignal(peer, 'ice', { sid, c: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (peer.pc !== pc) return;
      const index = pc.getTransceivers().indexOf(e.transceiver);
      const kind = ['mic', 'cam', 'screen'][index];
      if (!kind) return;
      peer.tracks[kind] = e.track;
      if (kind === 'mic') {
        peer.audio.srcObject = new MediaStream([e.track]);
        playSound(peer);
      }
      renderPeer(peer);
    };
    pc.onconnectionstatechange = () => connectionChanged(peer, pc);
    return pc;
  }

  // Puts this student's microphone, camera and screen (or nothing) on the
  // connection's three lines.
  function attachLocalTracks(peer) {
    if (!peer.pc) return;
    const lines = peer.pc.getTransceivers();
    [media.mic, media.cam, media.screen].forEach((track, i) => {
      const sender = lines[i] && lines[i].sender;
      if (sender && sender.track !== track) sender.replaceTrack(track).catch(() => {});
    });
  }

  async function startPeer(peer) {
    if (peers.get(peer.id) !== peer || !ice) return;
    // Relay passwords from hours ago may have run out.
    if (Date.now() - ice.at > MEET_RELAY_FRESH_MS) ice = (await loadRelay()) || ice;
    if (peers.get(peer.id) !== peer || phase !== 'call') return;
    const pc = openConnection(peer, randomId());
    attachLocalTracks(peer);
    await sendOffer(peer, pc, false);
  }

  async function sendOffer(peer, pc, iceRestart) {
    try {
      const offer = await pc.createOffer({ iceRestart });
      if (peer.pc !== pc) return;
      await pc.setLocalDescription(offer);
      if (peer.pc !== pc) return;
      queueSignal(peer, 'offer', { sid: peer.sid, sdp: pc.localDescription.sdp });
      // Not connected within 20 seconds: start over.
      window.clearTimeout(peer.timer);
      peer.timer = window.setTimeout(() => {
        if (peer.pc === pc && pc.connectionState !== 'connected') retryPeer(peer);
      }, 20000);
    } catch (err) {
      console.error('Meeting offer failed', err);
      if (peer.pc === pc) retryPeer(peer);
    }
  }

  // Starts the connection to this participant from scratch, a little later
  // each time.
  function retryPeer(peer) {
    if (peers.get(peer.id) !== peer) return;
    closeConnection(peer);
    setTileStatus(peer.tile, 'Jungiamasi…');
    if (!peer.starts) return; // The other side starts it again.
    peer.attempts += 1;
    peer.restarts = 0;
    peer.timer = window.setTimeout(() => startPeer(peer), Math.min(1000 * 2 ** Math.min(peer.attempts, 4), 15000));
  }

  function connectionChanged(peer, pc) {
    if (peer.pc !== pc) return;
    const state = pc.connectionState;
    if (state === 'connected') {
      window.clearTimeout(peer.timer);
      peer.timer = null;
      peer.attempts = 0;
      peer.restarts = 0;
      setTileStatus(peer.tile, '');
      applyQuality();
      sendState(peer);
      return;
    }
    if (state === 'disconnected') {
      setTileStatus(peer.tile, 'Ryšys trūkinėja…');
      // Often comes back by itself; if not, find a new route.
      window.clearTimeout(peer.timer);
      peer.timer = window.setTimeout(() => {
        if (peer.pc === pc && pc.connectionState !== 'connected') repairPeer(peer, pc);
      }, 4000);
    } else if (state === 'failed') {
      repairPeer(peer, pc);
    } else if (state === 'closed') {
      retryPeer(peer);
    }
  }

  // The connection broke: the side that started it looks for a new route
  // twice, then starts over. The other side waits for that, and gives up on
  // the old connection after half a minute.
  async function repairPeer(peer, pc) {
    if (peer.pc !== pc) return;
    setTileStatus(peer.tile, 'Jungiamasi…');
    if (!peer.starts) {
      window.clearTimeout(peer.timer);
      peer.timer = window.setTimeout(() => {
        if (peer.pc === pc && pc.connectionState !== 'connected') closeConnection(peer);
      }, 30000);
      return;
    }
    if (peer.restarts >= 2 || pc.signalingState !== 'stable') {
      retryPeer(peer);
      return;
    }
    peer.restarts += 1;
    if (Date.now() - ice.at > MEET_RELAY_FRESH_MS) {
      ice = (await loadRelay()) || ice;
      if (peer.pc !== pc) return;
      try {
        pc.setConfiguration({ iceServers: ice.iceServers, iceTransportPolicy: ice.iceTransportPolicy, bundlePolicy: 'max-bundle' });
      } catch {
        retryPeer(peer);
        return;
      }
    }
    await sendOffer(peer, pc, true);
  }

  async function handleSignal(peer, kind, data) {
    if (typeof data.sid !== 'string' || data.sid.length > 64) return;

    if (kind === 'offer') {
      // Only the later arrival offers; an offer from the other side is a mistake.
      if (peer.starts || typeof data.sdp !== 'string') return;
      const pc = peer.pc && peer.sid === data.sid ? peer.pc : openConnection(peer, data.sid);
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        if (peer.pc !== pc) return;
        peer.remoteSet = true;
        pc.getTransceivers().slice(0, 3).forEach((line) => {
          line.direction = 'sendrecv';
        });
        attachLocalTracks(peer);
        await pc.setLocalDescription(await pc.createAnswer());
        if (peer.pc !== pc) return;
        queueSignal(peer, 'answer', { sid: peer.sid, sdp: pc.localDescription.sdp });
        await addCandidates(peer, pc);
      } catch (err) {
        console.error('Meeting answer failed', err);
        if (peer.pc !== pc) return;
        // Tell the starting side right away, so it starts over instead of
        // waiting for an answer that won't come.
        closeConnection(peer);
        queueSignal(peer, 'answer', { sid: data.sid, failed: true });
      }
      return;
    }

    if (!peer.pc || data.sid !== peer.sid) return;
    const { pc } = peer;

    if (kind === 'answer') {
      if (!peer.starts) return;
      if (data.failed === true) {
        retryPeer(peer);
        return;
      }
      if (typeof data.sdp !== 'string' || pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        if (peer.pc !== pc) return;
        peer.remoteSet = true;
        await addCandidates(peer, pc);
      } catch (err) {
        console.error('Meeting connection failed', err);
        if (peer.pc === pc) retryPeer(peer);
      }
    } else if (kind === 'ice') {
      const c = data.c;
      if (!c || typeof c !== 'object' || typeof c.candidate !== 'string' || c.candidate.length > 2000) return;
      peer.candidates.push({
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid : null,
        sdpMLineIndex: typeof c.sdpMLineIndex === 'number' ? c.sdpMLineIndex : null,
        usernameFragment: typeof c.usernameFragment === 'string' ? c.usernameFragment : undefined,
      });
      if (peer.remoteSet) await addCandidates(peer, pc);
    }
  }

  // Network addresses can arrive before the offer or answer they belong to;
  // they wait in peer.candidates until then.
  async function addCandidates(peer, pc) {
    while (peer.pc === pc && peer.candidates.length) {
      const candidate = peer.candidates.shift();
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // An address for an earlier round of this connection; harmless.
      }
    }
  }

  // Tells a participant's browser what this one is doing. They show it, but
  // names and who is the organizer never come this way.
  function sendState(peer) {
    if (!peer.channel || peer.channel.readyState !== 'open') return;
    try {
      peer.channel.send(JSON.stringify({ t: 'state', mic: media.micOn, cam: media.camOn, screen: Boolean(media.screen), hand: media.hand }));
    } catch {
      // The channel is closing.
    }
  }

  function peerSaid(peer, raw) {
    if (typeof raw !== 'string' || raw.length > 500) return;
    // More than 30 messages a second is not a browser behaving normally.
    const second = Math.floor(Date.now() / 1000);
    if (peer.messagesAt !== second) {
      peer.messagesAt = second;
      peer.messages = 0;
    }
    peer.messages += 1;
    if (peer.messages > 30) return;

    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (message.t === 'state') {
      const raisedNow = message.hand === true && !peer.says.hand;
      peer.says = { mic: message.mic === true, cam: message.cam === true, screen: message.screen === true, hand: message.hand === true };
      renderPeer(peer);
      renderPeople();
      if (raisedNow) toast(`${peerName(peer)} pakėlė ranką.`);
    } else if (message.t === 'bye') {
      gone.set(peer.id, { conn: peer.conn, at: Date.now() });
      removePeer(peer);
      layout();
      applyQuality();
      renderPeople();
    }
  }

  function playSound(peer) {
    const playing = peer.audio.play();
    if (playing) {
      playing.catch(() => {
        // The browser wants a click first.
        soundNotice.hidden = false;
      });
    }
  }
  $('call-sound-on').addEventListener('click', () => {
    soundNotice.hidden = true;
    if (audioContext) audioContext.resume().catch(() => {});
    peers.forEach((peer) => peer.audio.play().catch(() => {}));
  });

  // --- Names and pictures of the others --------------------------------------

  const peerName = (peer) => (cards.has(peer.id) ? cards.get(peer.id).name : 'Dalyvis');

  // Fetches the profile cards this page doesn't have yet.
  async function loadCards(ids) {
    const missing = ids.filter((id) => !cards.has(id) && !cardsAsked.has(id));
    if (!missing.length) return;
    missing.forEach((id) => cardsAsked.add(id));
    const res = await meetingRpc('meeting_people', { p_code: code, p_ids: missing });
    missing.forEach((id) => cardsAsked.delete(id));
    if (!res.ok || !Array.isArray(res.people)) return;
    res.people.forEach((person) => {
      if (!person || !missing.includes(person.id)) return;
      cards.set(person.id, {
        id: person.id,
        name: typeof person.name === 'string' ? person.name : 'Dalyvis',
        username: typeof person.username === 'string' ? person.username : '',
        avatar: meetingAvatar(person.avatar),
        grade: typeof person.grade === 'number' ? person.grade : null,
        school: typeof person.school === 'string' ? person.school : '',
      });
    });
    peers.forEach(renderPeer);
    renderPeople();
    renderKnockCards();
    renderChatNames();
  }

  // Brings one participant's pictures in line with what is known about them.
  function renderPeer(peer) {
    const card = cards.get(peer.id);
    const name = card ? card.name : 'Dalyvis';
    peer.tile.name.textContent = name;
    peer.tile.img.src = card ? card.avatar : DEFAULT_AVATAR;
    peer.tile.el.classList.toggle('is-muted', !peer.says.mic);
    peer.tile.hand.hidden = !peer.says.hand;
    setTileVideo(peer.tile, peer.tracks.cam, peer.says.cam && !peer.hiddenByMe);
    peer.audio.muted = peer.mutedByMe;

    if (peer.says.mic && peer.tracks.mic && !peer.mutedByMe) {
      if (!meters.has(peer.id)) watchVoice(peer.id, peer.tracks.mic, (on) => peer.tile.el.classList.toggle('is-speaking', on));
    } else {
      unwatchVoice(peer.id);
    }

    // Their screen gets a picture of its own, shown large when it appears.
    const sharing = peer.says.screen && Boolean(peer.tracks.screen) && !peer.hiddenByMe;
    if (sharing && !peer.screenTile) {
      peer.screenTile = makeTile({ screen: true });
      spotTile = peer.screenTile;
    }
    if (peer.screenTile) {
      if (sharing) {
        peer.screenTile.name.textContent = `${name} rodo ekraną`;
        setTileVideo(peer.screenTile, peer.tracks.screen, true);
      } else {
        peer.screenTile.el.remove();
        peer.screenTile = null;
      }
      layout();
    }
  }

  // --- Participants panel and chat panel -------------------------------------

  const panel = $('call-panel');
  const panelViews = { people: $('panel-people'), chat: $('panel-chat') };
  const panelToggles = { people: $('call-people-toggle'), chat: $('call-chat-toggle') };
  const peopleList = $('panel-people-list');
  const personTemplate = $('tpl-person');
  let openPanel = null;

  function setPanel(name) {
    closeMenu();
    openPanel = name;
    panel.hidden = !name;
    $('call-body').classList.toggle('has-panel', Boolean(name));
    Object.entries(panelViews).forEach(([key, view]) => {
      view.hidden = key !== name;
      panelToggles[key].setAttribute('aria-pressed', String(key === name));
    });
    if (name === 'people') {
      renderPeople();
      $('panel-people-title').focus();
    } else if (name === 'chat') {
      setUnread(0);
      chatList.scrollTop = chatList.scrollHeight;
      if (window.matchMedia('(min-width: 960px)').matches) chatInput.focus();
      else $('panel-chat-title').focus();
    }
    measure();
  }
  Object.entries(panelToggles).forEach(([name, button]) => {
    button.addEventListener('click', () => setPanel(openPanel === name ? null : name));
  });
  panel.querySelectorAll('[data-close-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      const toggle = panelToggles[openPanel];
      setPanel(null);
      if (toggle) toggle.focus();
    });
  });

  // A participant's menu floats over the list (which scrolls) instead of
  // sitting inside it.
  let menu = null; // { list, toggle }
  let peopleStale = false;

  function closeMenu(returnFocus) {
    if (!menu) return;
    const { list, toggle } = menu;
    menu = null;
    list.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) toggle.focus();
    if (peopleStale) renderPeople();
  }

  function openMenu(toggle, list) {
    closeMenu();
    list.hidden = false;
    list.classList.add('is-floating');
    const at = toggle.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.right - list.offsetWidth, window.innerWidth - list.offsetWidth - 8));
    const below = at.bottom + 6;
    const top = below + list.offsetHeight > window.innerHeight - 8 ? Math.max(8, at.top - list.offsetHeight - 6) : below;
    list.style.left = `${left}px`;
    list.style.top = `${top}px`;
    toggle.setAttribute('aria-expanded', 'true');
    menu = { list, toggle };
    const first = list.querySelector('button');
    if (first) first.focus();
  }
  document.addEventListener('click', (e) => {
    if (menu && !menu.list.contains(e.target) && !menu.toggle.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu) {
      e.preventDefault();
      closeMenu(true);
    }
  });
  $('panel-people-scroll').addEventListener('scroll', () => closeMenu());
  window.addEventListener('resize', () => closeMenu());

  function menuItem(label, run, danger) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    if (danger) button.className = 'is-danger';
    button.textContent = label;
    button.addEventListener('click', () => {
      closeMenu();
      run();
    });
    return button;
  }

  function personRow({ name, meta, avatar, muted, hand, items }) {
    const li = personTemplate.content.firstElementChild.cloneNode(true);
    li.querySelector('img').src = avatar;
    li.querySelector('.meet-person-name').textContent = name;
    li.querySelector('.meet-person-meta').textContent = meta;
    li.querySelector('.meet-person-muted').toggleAttribute('hidden', !muted);
    li.querySelector('.meet-person-hand').toggleAttribute('hidden', !hand);
    const menuBox = li.querySelector('.chat-menu');
    if (!items || !items.length) {
      menuBox.classList.add('is-empty');
      menuBox.querySelector('.chat-menu-toggle').disabled = true;
      return li;
    }
    const toggle = menuBox.querySelector('.chat-menu-toggle');
    const list = menuBox.querySelector('.chat-menu-list');
    toggle.setAttribute('aria-label', `Veiksmai: ${name}`);
    list.append(...items);
    toggle.addEventListener('click', () => {
      if (menu && menu.toggle === toggle) closeMenu();
      else openMenu(toggle, list);
    });
    return li;
  }

  function renderPeople() {
    const count = peers.size + 1;
    const badge = $('call-people-count');
    badge.textContent = String(count);
    badge.hidden = count < 2;
    if (openPanel !== 'people') return;
    // An open menu would vanish under the student's finger.
    if (menu) {
      peopleStale = true;
      return;
    }
    peopleStale = false;

    const owner = room && room.owner;
    const rows = [personRow({
      name: `${me.name || 'Tu'} (tu)`,
      meta: owner === me.id ? WORDS.hosts : '',
      avatar: me.avatar,
      muted: !media.micOn,
      hand: media.hand,
    })];
    [...peers.values()].sort((a, b) => a.seq - b.seq).forEach((peer) => {
      const card = cards.get(peer.id);
      const items = [
        menuItem(peer.mutedByMe ? 'Vėl girdėti' : 'Nutildyti tik sau', () => {
          peer.mutedByMe = !peer.mutedByMe;
          renderPeer(peer);
          renderPeople();
        }),
        menuItem(peer.hiddenByMe ? 'Vėl rodyti vaizdą' : 'Slėpti vaizdą tik sau', () => {
          peer.hiddenByMe = !peer.hiddenByMe;
          renderPeer(peer);
          renderPeople();
        }),
      ];
      if (owner === me.id) {
        if (peer.says.mic) items.push(menuItem('Išjungti mikrofoną', () => askPeer(peer, 'mute')));
        if (peer.says.cam) items.push(menuItem('Išjungti kamerą', () => askPeer(peer, 'cam_off')));
        if (peer.says.screen) items.push(menuItem('Sustabdyti ekrano rodymą', () => askPeer(peer, 'share_off')));
      }
      items.push(menuItem('Pranešti Mokify', () => openReport(peer), true));
      if (owner === me.id) items.push(menuItem('Pašalinti iš susitikimo', () => removeFromMeeting(peer), true));
      rows.push(personRow({
        name: peerName(peer),
        meta: owner === peer.id ? WORDS.hosts : (card ? meetingPersonMeta(card) : ''),
        avatar: card ? card.avatar : DEFAULT_AVATAR,
        muted: !peer.says.mic,
        hand: peer.says.hand,
        items,
      }));
    });
    peopleList.replaceChildren(...rows);
  }

  // Organizer: asks a participant's browser to switch something off.
  function askPeer(peer, action) {
    queueSignal(peer, 'ctl', { action });
  }

  function removeFromMeeting(peer) {
    const name = peerName(peer);
    askToConfirm({
      title: 'Pašalinti iš susitikimo?',
      text: `Dalyvis ${name} bus iškart atjungtas ir į šį susitikimą nebegalės grįžti.`,
      ok: 'Pašalinti',
      run: async () => {
        const result = await meetingRpc('meeting_remove', { p_code: code, p_user: peer.id });
        if (result.ok) syncSoon(0);
        return result;
      },
    });
  }

  if (lockBox) lockBox.addEventListener('change', async (e) => {
    const box = e.target;
    box.disabled = true;
    const result = await meetingRpc('meeting_lock', { p_code: code, p_locked: box.checked });
    box.disabled = false;
    if (!result.ok) {
      box.checked = !box.checked;
      toast(MEET_ERRORS[result.error] || MEET_ERRORS.failed);
    }
  });

  // --- Requests to come in (organizer) ---------------------------------------

  const knocksEl = $('call-knocks');
  const knockTemplate = $('tpl-knock');
  let knocking = []; // Student ids, oldest request first.
  const deciding = new Set();

  function renderKnocks(waiting) {
    const ids = waiting.map((w) => w && w.id).filter((id) => UUID_PATTERN.test(id || ''));
    if (ids.some((id) => !knocking.includes(id))) chime();
    const same = ids.length === knocking.length && ids.every((id, i) => id === knocking[i]);
    knocking = ids;
    loadCards(ids);
    if (!same) renderKnockCards();
  }

  function renderKnockCards() {
    knocksEl.replaceChildren(...knocking.map((id) => {
      const card = cards.get(id);
      const li = knockTemplate.content.firstElementChild.cloneNode(true);
      li.querySelector('img').src = card ? card.avatar : DEFAULT_AVATAR;
      li.querySelector('.meet-knock-name').textContent = card ? `${card.name} nori prisijungti` : 'Kraunama…';
      li.querySelector('.meet-knock-meta').textContent = card ? meetingPersonMeta(card) : '';
      const admit = li.querySelector('[data-admit]');
      const deny = li.querySelector('[data-deny]');
      // Nobody is let in before the organizer can see who it is.
      admit.disabled = !card || deciding.has(id);
      deny.disabled = deciding.has(id);
      admit.addEventListener('click', () => decide(id, true));
      deny.addEventListener('click', () => decide(id, false));
      return li;
    }));
  }

  async function decide(id, admit) {
    if (deciding.has(id)) return;
    deciding.add(id);
    renderKnockCards();
    const result = await meetingRpc('meeting_decide', { p_code: code, p_user: id, p_admit: admit });
    deciding.delete(id);
    if (result.ok || result.error === 'not_waiting') {
      knocking = knocking.filter((other) => other !== id);
    } else if (result.error === 'full') {
      toast(MEET_ERRORS.full, 6000);
    } else if (result.error === 'refused') {
      toast('Šio moksleivio įleisti negalima.', 6000);
    } else {
      toast(MEET_ERRORS[result.error] || MEET_ERRORS.failed, 6000);
    }
    renderKnockCards();
    syncSoon(0);
  }

  // --- Chat ------------------------------------------------------------------

  const chatList = $('call-chat');
  const chatForm = $('call-chat-form');
  const chatInput = $('call-chat-input');
  const chatSend = $('call-chat-send');
  const chatError = $('call-chat-error');
  let unread = 0;

  function setUnread(count) {
    unread = count;
    const badge = $('call-chat-count');
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = !count;
    panelToggles.chat.setAttribute('aria-label', count ? `Pokalbis, ${count} ${pluralLt(count, 'nauja žinutė', 'naujos žinutės', 'naujų žinučių')}` : 'Pokalbis');
  }

  function appendChat(messages) {
    const fresh = messages.filter((m) => m && typeof m.id === 'number' && m.id > lastChatId && typeof m.body === 'string');
    if (!fresh.length) return;
    const stick = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 80;
    let fromOthers = 0;
    fresh.forEach((m) => {
      lastChatId = m.id;
      const mine = m.from === me.id;
      const li = document.createElement('li');
      li.className = `chat-message${mine ? ' is-mine' : ''}`;
      if (!mine) {
        fromOthers += 1;
        const from = document.createElement('span');
        from.className = 'meet-chat-from';
        from.dataset.from = m.from;
        from.textContent = cards.has(m.from) ? cards.get(m.from).name : 'Dalyvis';
        li.appendChild(from);
      }
      const body = document.createElement('p');
      body.textContent = m.body;
      const time = document.createElement('time');
      const at = new Date(m.at);
      time.dateTime = m.at;
      time.textContent = Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' });
      li.append(body, time);
      chatList.appendChild(li);
    });
    loadCards([...new Set(fresh.map((m) => m.from).filter((id) => UUID_PATTERN.test(id || '') && id !== me.id))]);
    if (openPanel === 'chat') {
      if (stick) chatList.scrollTop = chatList.scrollHeight;
    } else if (fromOthers) {
      setUnread(unread + fromOthers);
    }
  }

  // Fills in names of chat authors once their cards have loaded.
  function renderChatNames() {
    chatList.querySelectorAll('.meet-chat-from').forEach((el) => {
      const card = cards.get(el.dataset.from);
      if (card) el.textContent = card.name;
    });
  }

  const growChatInput = () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${chatInput.scrollHeight}px`;
  };
  chatInput.addEventListener('input', () => {
    growChatInput();
    showBanner(chatError, '');
  });
  // Enter sends, Shift+Enter starts a new line.
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = chatInput.value.trim();
    if (!body || chatSend.disabled) return;
    if (body.length > MEET_CHAT_MAX_LENGTH) {
      showBanner(chatError, `Žinutė gali būti iki ${MEET_CHAT_MAX_LENGTH} simbolių.`);
      return;
    }
    setBusy(chatSend, true, 'Siunčiama…');
    const result = await meetingRpc('meeting_say', { p_code: code, p_conn: conn, p_body: body });
    setBusy(chatSend, false);
    if (!result.ok) {
      showBanner(chatError, result.error === 'limit' ? 'Per daug žinučių iš karto. Palauk minutę.' : (MEET_ERRORS[result.error] || 'Nepavyko išsiųsti žinutės. Pabandyk dar kartą.'));
      return;
    }
    chatInput.value = '';
    growChatInput();
    chatInput.focus();
    // The message shows up with the next news from the database, in the
    // same order everyone else sees.
    chatList.scrollTop = chatList.scrollHeight;
    syncSoon(0);
  });

  // --- Reporting a participant -----------------------------------------------

  const reportDialog = $('report-dialog');
  const reportForm = $('report-form');
  const reportDone = $('report-done');
  const reportSend = $('report-send');
  const reportError = $('report-error');
  let reportTarget = null;

  const setReasonError = (message) => {
    $('report-reason-field').classList.toggle('has-error', Boolean(message));
    $('report-reason-error').textContent = message;
  };

  function openReport(peer) {
    reportTarget = peer.id;
    reportForm.reset();
    reportForm.hidden = false;
    reportDone.hidden = true;
    setReasonError('');
    showBanner(reportError, '');
    $('report-who').textContent = `Praneši apie: ${peerName(peer)}. Tai pamatys tik Mokify komanda.`;
    reportDialog.showModal();
  }
  reportForm.addEventListener('change', () => setReasonError(''));
  reportForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = reportForm.elements.reason.value;
    if (!reason) {
      setReasonError('Pasirink, kas nutiko.');
      reportForm.elements.reason[0].focus();
      return;
    }
    showBanner(reportError, '');
    setBusy(reportSend, true, 'Siunčiama…');
    const result = await meetingRpc('meeting_report', {
      p_code: code, p_user: reportTarget, p_reason: reason, p_details: reportForm.elements.details.value,
    });
    setBusy(reportSend, false);
    if (!result.ok) {
      showBanner(reportError, result.error === 'limit' ? 'Per valandą galima išsiųsti iki 10 pranešimų. Pabandyk vėliau.' : (MEET_ERRORS[result.error] || MEET_ERRORS.failed));
      return;
    }
    reportForm.hidden = true;
    reportDone.hidden = false;
    $('report-done-title').focus();
  });
  $('report-cancel').addEventListener('click', () => reportDialog.close());
  $('report-close').addEventListener('click', () => reportDialog.close());

  // --- Whiteboard ------------------------------------------------------------
  // A shared board for explaining things. Everyone in the call draws on the
  // same 1600×1000 sheet, shown in the same shape on every screen, so a
  // drawing lands in the same place for all. Lines travel directly between the
  // browsers over their own channel (id 1, next to the call's channel 0),
  // never through a server, and are gone when the meeting ends. Whoever comes
  // in later gets the whole board from the others.
  const BOARD_W = 1600;
  const BOARD_H = 1000;
  // Colour 4 is the eraser: a line in the board's own white, so erasing
  // works just like drawing (anywhere you drag, it rubs out), syncs the same
  // way, and "undo" brings back what was erased.
  const BOARD_COLORS = ['#201E1B', '#2B4C8C', '#C0392B', '#2E7D4F', '#FFFFFF'];
  const BOARD_ERASER = 4;
  const BOARD_SIZES = [3, 9];
  const ERASER_SIZES = [22, 56];
  const lineWidth = (s) => (s.c === BOARD_ERASER ? ERASER_SIZES[s.w] : BOARD_SIZES[s.w]);
  const BOARD_MAX_STROKES = 3000;
  const BOARD_MAX_NUMBERS = 8000; // 4000 points per line
  const BOARD_CHUNK = 600; // numbers per message
  const boardEl = $('call-board');
  const boardToggle = $('call-board-toggle');
  const boardNew = $('call-board-new');
  const boardArea = $('call-board-area');
  const boardCanvas = $('call-board-canvas');
  const boardCtx = boardCanvas ? boardCanvas.getContext('2d') : null;
  const strokes = new Map(); // id -> { id, mine, c, w, p: [x, y, x, y, ...] }
  let myStrokes = []; // my own line ids, newest last (for "undo")
  let boardOpen = false;
  let boardTool = 'pen';
  let boardColor = 0;
  let boardSize = 0;
  let drawing = null; // my line being drawn: { stroke, sent, pending }
  let flushTimer = 0;
  let boardScale = 1; // screen pixels per board unit
  let boardNoticed = false;

  const newStrokeId = () => Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  const validPoints = (p) => Array.isArray(p) && p.length % 2 === 0 && p.length <= BOARD_MAX_NUMBERS
    && p.every((n) => Number.isInteger(n) && n >= -50 && n <= BOARD_W + 50);
  const validId = (id) => typeof id === 'string' && /^[a-z0-9]{6,16}$/.test(id);

  function boardResize() {
    if (!boardOpen || !boardCtx) return;
    const w = boardArea.clientWidth;
    const h = boardArea.clientHeight;
    if (!w || !h) return;
    const cssW = Math.max(200, Math.floor(Math.min(w, (h * BOARD_W) / BOARD_H)));
    const cssH = Math.floor((cssW * BOARD_H) / BOARD_W);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    boardCanvas.style.width = `${cssW}px`;
    boardCanvas.style.height = `${cssH}px`;
    boardCanvas.width = Math.round(cssW * dpr);
    boardCanvas.height = Math.round(cssH * dpr);
    boardScale = cssW / BOARD_W;
    redrawBoard();
  }

  function drawStroke(ctx, s, from = 0) {
    const p = s.p;
    if (p.length < 2) return;
    ctx.strokeStyle = BOARD_COLORS[s.c];
    ctx.lineWidth = lineWidth(s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const start = Math.max(0, from - 2);
    ctx.moveTo(p[start], p[start + 1]);
    if (p.length === 2) ctx.lineTo(p[0] + 0.01, p[1]); // a dot
    for (let i = start + 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  }

  function useBoardScale() {
    const dpr = boardCanvas.width / (BOARD_W * boardScale);
    boardCtx.setTransform(dpr * boardScale, 0, 0, dpr * boardScale, 0, 0);
  }

  function redrawBoard() {
    if (!boardOpen || !boardCtx) return;
    boardCtx.setTransform(1, 0, 0, 1, 0, 0);
    boardCtx.fillStyle = '#FFFFFF';
    boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    useBoardScale();
    strokes.forEach((s) => drawStroke(boardCtx, s));
  }

  // Draws only the newest piece of a line (cheaper than drawing everything).
  function drawTail(s, from) {
    if (!boardOpen || !boardCtx) return;
    useBoardScale();
    drawStroke(boardCtx, s, from);
  }

  // Sends to everyone (or one participant), in order, a little at a time so a
  // big board doesn't flood the connection.
  function boardQueue(peer, raw) {
    if (!peer.board || peer.board.readyState !== 'open') return;
    peer.boardOut = peer.boardOut || [];
    peer.boardOut.push(raw);
    if (!peer.boardPump) {
      const pump = () => {
        const next = peer.boardOut && peer.boardOut.shift();
        if (!next || !peer.board || peer.board.readyState !== 'open') {
          peer.boardPump = 0;
          peer.boardOut = [];
          return;
        }
        try {
          peer.board.send(next);
        } catch {
          // The channel is closing.
        }
        peer.boardPump = peer.boardOut.length ? window.setTimeout(pump, 12) : 0;
      };
      peer.boardPump = window.setTimeout(pump, 0);
    }
  }
  const boardSend = (message) => {
    const raw = JSON.stringify(message);
    peers.forEach((peer) => boardQueue(peer, raw));
  };

  // A line in messages: its start, then more points in pieces.
  function strokeMessages(s) {
    const out = [JSON.stringify({ t: 's', id: s.id, c: s.c, w: s.w, p: s.p.slice(0, BOARD_CHUNK) })];
    for (let i = BOARD_CHUNK; i < s.p.length; i += BOARD_CHUNK) {
      out.push(JSON.stringify({ t: 'a', id: s.id, p: s.p.slice(i, i + BOARD_CHUNK) }));
    }
    return out;
  }

  // A participant's board channel opened: give them everything on the board.
  function boardSendAll(peer) {
    strokes.forEach((s) => strokeMessages(s).forEach((raw) => boardQueue(peer, raw)));
    videoSendTo(peer);
  }

  function flushDrawing() {
    window.clearTimeout(flushTimer);
    flushTimer = 0;
    if (!drawing || !drawing.pending.length) return;
    const s = drawing.stroke;
    while (drawing.pending.length) {
      const part = drawing.pending.splice(0, BOARD_CHUNK);
      boardSend(drawing.sent ? { t: 'a', id: s.id, p: part } : { t: 's', id: s.id, c: s.c, w: s.w, p: part });
      drawing.sent = true;
    }
  }
  const scheduleFlush = () => {
    if (!flushTimer) flushTimer = window.setTimeout(flushDrawing, 40);
  };

  function boardPoint(e) {
    const rect = boardCanvas.getBoundingClientRect();
    return [
      Math.round(Math.min(BOARD_W, Math.max(0, (e.clientX - rect.left) / boardScale))),
      Math.round(Math.min(BOARD_H, Math.max(0, (e.clientY - rect.top) / boardScale))),
    ];
  }

  function removeStrokes(ids, tell) {
    ids.forEach((id) => strokes.delete(id));
    myStrokes = myStrokes.filter((id) => strokes.has(id));
    redrawBoard();
    if (tell) boardSend({ t: 'x', ids });
  }

  function clearBoard(tell) {
    strokes.clear();
    myStrokes = [];
    drawing = null;
    redrawBoard();
    if (tell) boardSend({ t: 'clear' });
  }

  if (boardCanvas) {
    boardCanvas.addEventListener('pointerdown', (e) => {
      if (!boardOpen || e.button !== 0) return;
      e.preventDefault();
      try {
        boardCanvas.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is already gone; drawing still works without it.
      }
      const [x, y] = boardPoint(e);
      if (strokes.size >= BOARD_MAX_STROKES) {
        toast('Lenta pilna. Išvalyk ją, kad galėtum piešti toliau.');
        return;
      }
      const color = boardTool === 'eraser' ? BOARD_ERASER : boardColor;
      const stroke = { id: newStrokeId(), mine: true, c: color, w: boardSize, p: [x, y] };
      strokes.set(stroke.id, stroke);
      myStrokes.push(stroke.id);
      drawing = { stroke, sent: false, pending: [x, y] };
      drawTail(stroke, 0);
      scheduleFlush();
    });
    boardCanvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      (events.length ? events : [e]).forEach((ev) => {
        const [x, y] = boardPoint(ev);
        const p = drawing.stroke.p;
        if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 2 || p.length >= BOARD_MAX_NUMBERS) return;
        p.push(x, y);
        drawing.pending.push(x, y);
        drawTail(drawing.stroke, p.length - 2);
      });
      scheduleFlush();
    });
    const endLine = () => {
      if (!drawing) return;
      flushDrawing();
      drawing = null;
    };
    boardCanvas.addEventListener('pointerup', endLine);
    boardCanvas.addEventListener('pointercancel', endLine);
  }

  // A message from another participant's board.
  function boardSaid(peer, raw) {
    if (typeof raw !== 'string' || raw.length > 20000) return;
    const second = Math.floor(Date.now() / 1000);
    if (peer.boardAt !== second) {
      peer.boardAt = second;
      peer.boardCount = 0;
    }
    peer.boardCount += 1;
    if (peer.boardCount > 150) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (m.t === 's') {
      if (!validId(m.id) || ![0, 1, 2, 3, BOARD_ERASER].includes(m.c) || ![0, 1].includes(m.w) || !validPoints(m.p) || !m.p.length) return;
      if (strokes.has(m.id) || strokes.size >= BOARD_MAX_STROKES) return;
      const s = { id: m.id, mine: false, c: m.c, w: m.w, p: m.p.slice() };
      strokes.set(s.id, s);
      drawTail(s, 0);
      boardActivity(peer);
    } else if (m.t === 'a') {
      const s = validId(m.id) && strokes.get(m.id);
      if (!s || s.mine || !validPoints(m.p) || s.p.length + m.p.length > BOARD_MAX_NUMBERS) return;
      const from = s.p.length;
      s.p.push(...m.p);
      drawTail(s, from);
    } else if (m.t === 'x') {
      if (!Array.isArray(m.ids) || m.ids.length > 500) return;
      removeStrokes(m.ids.filter(validId), false);
    } else if (m.t === 'clear') {
      if (!strokes.size) return;
      clearBoard(false);
      toast(`${peerName(peer)} išvalė lentą.`);
    } else if (m.t === 'v-load' || m.t === 'v-state' || m.t === 'v-close') {
      videoSaid(peer, m);
    }
  }

  // Someone drew while this board is closed: a dot on the button, and once a
  // short note.
  function boardActivity(peer) {
    if (boardOpen || !boardNew) return;
    boardNew.hidden = false;
    if (!boardNoticed) {
      boardNoticed = true;
      toast(`${peerName(peer)} piešia lentoje. Atidaryk ją mygtuku apačioje.`);
    }
  }

  function setBoard(open) {
    if (!boardEl) return;
    // The board and a video share the large place: one at a time.
    if (open && videoOpen) setVideo(false);
    boardOpen = open;
    setToggle(boardToggle, open, 'Uždaryti lentą', 'Atidaryti lentą');
    if (open) boardNew.hidden = true;
    if (!open) drawing = null;
    layout();
  }

  function resetBoard() {
    clearBoard(false);
    boardNoticed = false;
    if (!boardEl) return;
    boardOpen = false;
    boardEl.hidden = true;
    boardNew.hidden = true;
    setToggle(boardToggle, false, 'Uždaryti lentą', 'Atidaryti lentą');
  }

  if (boardEl) {
    boardToggle.addEventListener('click', () => setBoard(!boardOpen));
    $('board-close').addEventListener('click', () => setBoard(false));
    const pressOnly = (buttons, chosen) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === chosen)));
    const toolButtons = [...boardEl.querySelectorAll('[data-tool]')];
    const colorButtons = [...boardEl.querySelectorAll('[data-color]')];
    const sizeButtons = [...boardEl.querySelectorAll('[data-size]')];
    const choosePen = () => {
      boardTool = 'pen';
      pressOnly(toolButtons, toolButtons.find((b) => b.dataset.tool === 'pen'));
      boardCanvas.classList.remove('is-erasing');
    };
    toolButtons.forEach((b) => b.addEventListener('click', () => {
      boardTool = b.dataset.tool;
      pressOnly(toolButtons, b);
      boardCanvas.classList.toggle('is-erasing', boardTool === 'eraser');
    }));
    colorButtons.forEach((b) => b.addEventListener('click', () => {
      boardColor = Number(b.dataset.color);
      pressOnly(colorButtons, b);
      choosePen();
    }));
    // The size is for the pen and the eraser alike.
    sizeButtons.forEach((b) => b.addEventListener('click', () => {
      boardSize = Number(b.dataset.size);
      pressOnly(sizeButtons, b);
    }));
    $('board-undo').addEventListener('click', () => {
      const id = myStrokes[myStrokes.length - 1];
      if (id) removeStrokes([id], true);
    });
    $('board-clear').addEventListener('click', () => {
      if (!strokes.size) return;
      askToConfirm({
        title: 'Išvalyti lentą?',
        text: 'Lenta bus išvalyta visiems susitikimo dalyviams.',
        ok: 'Išvalyti',
        run: async () => {
          clearBoard(true);
          return { ok: true };
        },
      });
    });
    // Saves the board as a picture on this computer (nothing is uploaded).
    $('board-save').addEventListener('click', () => {
      const c = document.createElement('canvas');
      c.width = BOARD_W;
      c.height = BOARD_H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);
      strokes.forEach((s) => drawStroke(ctx, s));
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const a = document.createElement('a');
      a.download = `mokify-lenta-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;
      a.href = c.toDataURL('image/png');
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  // --- Watching a YouTube video together --------------------------------------
  // Anyone in the call may show a video from youtube.com. The website's server
  // (functions/api/youtube.js) checks its YouTube category first: only
  // educational ones are allowed. Every page that receives a video checks it
  // again itself, so a tinkered browser can't push another one. Nothing from
  // YouTube loads until the student presses "Žiūrėti" (YouTube sees the IP
  // address of whoever watches). Play, pause and jumping to another moment
  // are passed on to everyone over the whiteboard's channel.
  const YT_ORIGIN = 'https://www.youtube-nocookie.com';
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const videoEl = $('call-video');
  const videoToggle = $('call-video-toggle');
  const videoNew = $('call-video-new');
  let videoOpen = false;
  let video = null; // { id, title, channel, by } — the video on now, if any
  let videoState = { playing: false, time: 0, at: 0 }; // where it is, for everyone
  const videoChecks = new Map(); // id -> the server's answer (a promise)
  const watched = new Set(); // ids this student agreed to load
  let ytFrame = null;
  let ytReady = false;
  let ytState = -1;
  let ytTime = 0;
  let ytTimeAt = 0;
  let quietUntil = 0; // changes made to follow the others aren't passed on

  const VIDEO_ERRORS = {
    bad_link: 'Įklijuok YouTube vaizdo įrašo nuorodą (youtube.com arba youtu.be).',
    category: 'Šio vaizdo įrašo rodyti negalima: jis nėra mokomasis.',
    age: 'Šis vaizdo įrašas skirtas tik suaugusiems.',
    not_embeddable: 'Šio vaizdo įrašo negalima rodyti kitose svetainėse arba jis privatus.',
    not_found: 'Tokio vaizdo įrašo YouTube nerasta.',
    live: 'Tiesioginių transliacijų rodyti negalima.',
    limit: 'Per daug bandymų. Palauk ir bandyk vėliau.',
    not_set_up: 'Vaizdo įrašai dar neįjungti.',
    failed: 'Nepavyko patikrinti vaizdo įrašo. Bandyk dar kartą.',
  };

  // The video's id from a youtube.com or youtu.be address (same rules as the
  // server), and where to start (?t=).
  function parseYoutube(text) {
    let url;
    try {
      url = new URL(String(text).trim());
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    let id = null;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else {
        const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
        if (m) id = m[1];
      }
    }
    if (!id || !VIDEO_ID.test(id)) return null;
    const t = url.searchParams.get('t') || url.searchParams.get('start') || '';
    const tm = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
    const start = tm ? (Number(tm[1] || 0) * 3600) + (Number(tm[2] || 0) * 60) + Number(tm[3] || 0) : 0;
    return { id, start: Math.min(start, 86400) };
  }

  // The server's verdict on a video (asked once per video per page).
  function checkVideo(id) {
    if (!videoChecks.has(id)) {
      const ask = (async () => {
        try {
          const current = (await getSession()) || session();
          const res = await fetch('/api/youtube', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current ? current.access_token : ''}` },
            body: JSON.stringify({ code, url: `https://www.youtube.com/watch?v=${id}` }),
          });
          if (res.status === 404) return { ok: false, error: 'not_set_up' };
          const data = await res.json();
          return data && typeof data.ok === 'boolean' ? data : { ok: false, error: 'failed' };
        } catch {
          return { ok: false, error: 'failed' };
        }
      })();
      videoChecks.set(id, ask);
      // A failed check may be tried again later.
      ask.then((r) => { if (!r.ok && ['failed', 'limit', 'not_set_up'].includes(r.error)) videoChecks.delete(id); });
    }
    return videoChecks.get(id);
  }

  const videoError = (r) => (r.error === 'category' && r.category
    ? `Šio vaizdo įrašo rodyti negalima: jo kategorija „${r.category}“. Galima rodyti tik švietimo, mokslo ir technologijų bei patarimų ir mokymų vaizdo įrašus.`
    : VIDEO_ERRORS[r.error] || VIDEO_ERRORS.failed);

  // Where the video is now for everyone (seconds).
  const videoNow = () => videoState.time + (videoState.playing ? (Date.now() - videoState.at) / 1000 : 0);

  function ytPost(func, args = []) {
    if (!ytFrame || !ytFrame.contentWindow) return;
    ytFrame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }), YT_ORIGIN);
  }

  function removePlayer() {
    if (ytFrame) ytFrame.remove();
    ytFrame = null;
    ytReady = false;
    ytState = -1;
  }

  function loadPlayer() {
    if (!video) return;
    removePlayer();
    watched.add(video.id);
    const frame = document.createElement('iframe');
    frame.title = `YouTube: ${video.title}`;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.src = `${YT_ORIGIN}/embed/${video.id}?enablejsapi=1&playsinline=1&rel=0&start=${Math.floor(videoNow())}&origin=${encodeURIComponent(window.location.origin)}&widgetid=1`;
    ytFrame = frame;
    $('video-frame').replaceChildren(frame);
    // Ask the player to report what it does (YouTube's own embed protocol).
    let tries = 0;
    const listen = () => {
      if (ytFrame !== frame || ytReady || tries > 40) return;
      tries += 1;
      frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN);
      window.setTimeout(listen, 250);
    };
    frame.addEventListener('load', listen);
    renderVideo();
  }

  // Follows the others: jump to their moment, play or pause like them.
  function followVideo() {
    if (!ytReady) return;
    quietUntil = Date.now() + 1500;
    const target = videoNow();
    const mine = ytTime + (ytState === 1 ? (Date.now() - ytTimeAt) / 1000 : 0);
    if (Math.abs(mine - target) > 1.5) ytPost('seekTo', [target, true]);
    ytPost(videoState.playing ? 'playVideo' : 'pauseVideo');
  }

  // This student played, paused or jumped: tell everyone.
  function shareVideoState(playing, time) {
    if (!video) return;
    videoState = { playing, time, at: Date.now() };
    boardSend({ t: 'v-state', id: video.id, playing, time: Math.round(time * 10) / 10 });
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== YT_ORIGIN || !ytFrame || e.source !== ytFrame.contentWindow) return;
    let d;
    try {
      d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (!d || typeof d !== 'object') return;
    // The player says it can be talked to: start listening to it.
    if (d.event === 'readyToListen') {
      ytFrame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN);
      return;
    }
    if (d.event === 'onReady' || (d.event === 'initialDelivery' && !ytReady)) {
      if (!ytReady) {
        ytReady = true;
        ytPost('addEventListener', ['onStateChange']);
        followVideo();
      }
      return;
    }
    const info = d.info;
    const quiet = Date.now() < quietUntil;
    if (d.event === 'infoDelivery' && info && typeof info === 'object') {
      if (typeof info.currentTime === 'number') {
        const expected = ytTime + (ytState === 1 ? (Date.now() - ytTimeAt) / 1000 : 0);
        const jumped = ytTimeAt && Math.abs(info.currentTime - expected) > 2;
        ytTime = info.currentTime;
        ytTimeAt = Date.now();
        if (jumped && !quiet && (ytState === 1 || ytState === 2)) shareVideoState(ytState === 1, ytTime);
      }
      if (typeof info.playerState === 'number') stateChanged(info.playerState, quiet);
    } else if (d.event === 'onStateChange' && typeof info === 'number') {
      stateChanged(info, quiet);
    }
  });

  function stateChanged(state, quiet) {
    if (state === ytState) return;
    ytState = state;
    if (quiet) return;
    // 1 playing, 2 paused (3 loading, 0 ended, 5 ready: nothing to pass on).
    if (state === 1 && !videoState.playing) shareVideoState(true, ytTime);
    else if (state === 2 && videoState.playing) shareVideoState(false, ytTime);
  }

  function renderVideo() {
    if (!videoEl) return;
    const loaded = Boolean(ytFrame);
    $('video-empty').hidden = Boolean(video);
    $('video-consent').hidden = !video || loaded;
    $('video-frame').hidden = !loaded;
    $('video-info').hidden = !video;
    if (video) {
      $('video-title').textContent = video.title;
      $('video-channel').textContent = video.channel ? `· ${video.channel}` : '';
      $('video-consent-title').textContent = video.title;
      $('video-consent-text').textContent = `${video.by ? `${video.by} rodo` : 'Rodomas'} vaizdo įrašą${video.channel ? ` iš kanalo „${video.channel}“` : ''}.`;
    }
    videoResize();
  }

  // The player is as large as fits, 16:9.
  function videoResize() {
    if (!videoOpen || !videoEl) return;
    const area = $('video-area');
    const box = $('video-box');
    const w = area.clientWidth;
    const h = area.clientHeight;
    if (!w || !h) return;
    const width = Math.max(240, Math.floor(Math.min(w, (h * 16) / 9)));
    box.style.width = `${width}px`;
    box.style.height = `${Math.floor((width * 9) / 16)}px`;
  }

  function setVideo(open) {
    if (!videoEl) return;
    videoOpen = open;
    if (open && boardOpen) {
      boardOpen = false;
      setToggle(boardToggle, false, 'Uždaryti lentą', 'Atidaryti lentą');
      drawing = null;
    }
    setToggle(videoToggle, open, 'Uždaryti vaizdo įrašą', 'Žiūrėti vaizdo įrašą kartu');
    if (open) {
      videoNew.hidden = true;
      // Already agreed to this one: straight back in.
      if (video && !ytFrame && watched.has(video.id)) loadPlayer();
    } else {
      removePlayer();
    }
    showBanner($('video-error'), '');
    layout();
    renderVideo();
  }

  // A video starts for everyone (shown by this student or another).
  function startVideo(verdict, by, start) {
    video = { id: verdict.id, title: verdict.title || 'Vaizdo įrašas', channel: verdict.channel || '', by };
    videoState = { playing: false, time: start, at: Date.now() };
    removePlayer();
    if (!videoOpen) {
      if (by) {
        videoNew.hidden = false;
        toast(`${by} rodo vaizdo įrašą. Atidaryk jį mygtuku apačioje.`);
      }
    }
    renderVideo();
  }

  function stopVideo(by) {
    if (!video) return;
    video = null;
    videoState = { playing: false, time: 0, at: 0 };
    removePlayer();
    if (videoNew) videoNew.hidden = true;
    if (by) toast(`${by} baigė rodyti vaizdo įrašą.`);
    renderVideo();
  }

  // Video messages from another participant (on the whiteboard's channel).
  async function videoSaid(peer, m) {
    if (m.t === 'v-load') {
      if (typeof m.id !== 'string' || !VIDEO_ID.test(m.id)) return;
      const start = Number.isFinite(m.start) ? Math.min(Math.max(0, m.start), 86400) : 0;
      const verdict = await checkVideo(m.id);
      if (!verdict.ok) {
        if (verdict.error === 'category' || verdict.error === 'age') toast(`${peerName(peer)} bandė parodyti vaizdo įrašą, kurio Mokify neleidžia.`);
        return;
      }
      startVideo(verdict, peerName(peer), start);
      if (Number.isFinite(m.time) && typeof m.playing === 'boolean') {
        videoState = { playing: m.playing, time: Math.min(Math.max(0, m.time), 86400), at: Date.now() };
      }
    } else if (m.t === 'v-state') {
      if (!video || m.id !== video.id || typeof m.playing !== 'boolean' || !Number.isFinite(m.time)) return;
      videoState = { playing: m.playing, time: Math.min(Math.max(0, m.time), 86400), at: Date.now() };
      followVideo();
    } else if (m.t === 'v-close') {
      stopVideo(peerName(peer));
    }
  }

  // Someone new connected: tell them about the video that is on.
  function videoSendTo(peer) {
    if (!video) return;
    boardQueue(peer, JSON.stringify({ t: 'v-load', id: video.id, start: 0, playing: videoState.playing, time: Math.round(videoNow() * 10) / 10 }));
  }

  function resetVideo() {
    video = null;
    videoState = { playing: false, time: 0, at: 0 };
    removePlayer();
    videoChecks.clear();
    watched.clear();
    if (!videoEl) return;
    videoOpen = false;
    videoEl.hidden = true;
    videoNew.hidden = true;
    setToggle(videoToggle, false, 'Uždaryti vaizdo įrašą', 'Žiūrėti vaizdo įrašą kartu');
    $('video-link').value = '';
    renderVideo();
  }

  if (videoEl) {
    videoToggle.addEventListener('click', () => setVideo(!videoOpen));
    $('video-close').addEventListener('click', () => setVideo(false));
    $('video-watch').addEventListener('click', loadPlayer);
    $('video-stop').addEventListener('click', () => {
      if (!video) return;
      boardSend({ t: 'v-close' });
      stopVideo(null);
    });
    $('video-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = $('video-error');
      showBanner(errorEl, '');
      const parsed = parseYoutube($('video-link').value);
      if (!parsed) {
        showBanner(errorEl, VIDEO_ERRORS.bad_link);
        return;
      }
      const button = $('video-show');
      setBusy(button, true, 'Tikrinama…');
      const verdict = await checkVideo(parsed.id);
      setBusy(button, false);
      if (!verdict.ok) {
        showBanner(errorEl, videoError(verdict));
        return;
      }
      $('video-link').value = '';
      startVideo(verdict, null, parsed.start);
      boardSend({ t: 'v-load', id: verdict.id, start: parsed.start });
      // Whoever showed it already agreed by pressing the button.
      loadPlayer();
    });
  }

  // --- Leaving ---------------------------------------------------------------

  const leaveDialog = $('leave-dialog');
  const leaveError = $('leave-error');
  const doneRejoin = $('done-rejoin');

  // Everything a call holds on to: connections, camera, microphone, timers.
  function tearDown() {
    stopSync();
    window.clearTimeout(outboxTimer);
    outboxTimer = null;
    outbox = [];
    peers.forEach((peer) => {
      try {
        if (peer.channel && peer.channel.readyState === 'open') peer.channel.send('{"t":"bye"}');
      } catch {
        // They find out from the database a moment later.
      }
    });
    [...peers.values()].forEach(removePeer);
    stopMedia();
    stopMeters();
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
    closeMenu();
    // A report being written stays open: it can still be sent afterwards.
    [leaveDialog, confirmDialog, devicesDialog].forEach((dialog) => {
      if (dialog.open) dialog.close();
    });
    if (selfTile) selfTile.el.remove();
    selfTile = null;
    spotTile = null;
    resetBoard();
    resetVideo();
    knocking = [];
    knocksEl.replaceChildren();
    chatList.replaceChildren();
    toastsEl.replaceChildren();
    setUnread(0);
    cards.clear();
    gone.clear();
    ice = null;
    room = null;
  }

  // The meeting is over for this student. tellServer: this page is the one
  // leaving (otherwise the database already knows). silent: no last screen.
  async function finish(reason, { tellServer = false, silent = false, ending: given = null } = {}) {
    if (phase !== 'call' && phase !== 'waiting' && phase !== 'lobby') return;
    const leftCode = code;
    const leftConn = conn;
    tearDown();
    if (lateBox) lateBox.hidden = true;
    if (!silent) {
      const ending = given || endings[reason] || endings.ended;
      $('done-title').textContent = ending.title;
      $('done-text').textContent = ending.text || '';
      $('done-text').hidden = !ending.text;
      // A finished lesson: the points (and the teacher's social hours) it gave.
      const rewards = $('done-rewards');
      if (rewards) {
        if (ending.rewards) renderLessonRewards(rewards, ending.rewards);
        else rewards.hidden = true;
      }
      // With rewards the last screen spreads out across the page (style.css).
      screens.done.classList.toggle('has-rewards', Boolean(rewards && !rewards.hidden));
      doneRejoin.hidden = !ending.rejoin;
      setPhase('done');
      $('done-title').focus();
    }
    if (tellServer) await meetingRpc('meeting_leave', { p_code: leftCode, p_conn: leftConn });
  }

  $('call-leave').addEventListener('click', () => {
    if (!isOwner()) {
      finish('left', { tellServer: true });
      return;
    }
    showBanner(leaveError, '');
    leaveDialog.showModal();
  });
  $('leave-only').addEventListener('click', () => {
    leaveDialog.close();
    finish('left', { tellServer: true });
  });
  $('leave-end').addEventListener('click', async (e) => {
    setBusy(e.currentTarget, true, 'Baigiama…');
    const result = await meetingRpc('meeting_end', { p_code: code });
    setBusy($('leave-end'), false);
    if (!result.ok) {
      showBanner(leaveError, MEET_ERRORS[result.error] || MEET_ERRORS.failed);
      return;
    }
    leaveDialog.close();
    finish('ended_by_me');
  });

  doneRejoin.addEventListener('click', () => openLobby(code));
  // From a lesson these two lead back to the chat, as ordinary links.
  if (!lessonMode) {
    [$('done-home'), lobbyBack].forEach((link) => link.addEventListener('click', (e) => {
      e.preventDefault();
      stopMedia();
      goHome();
    }));
  }

  // The link opens the meeting; the code is for typing into "Susitikimo kodas
  // arba nuoroda" on the meetings page.
  // (Each button has a long label and a short one for phones.)
  function copyButton(id, value, ask) {
    const button = $(id);
    if (!button) return;
    const labels = [...button.childNodes];
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value());
        button.textContent = 'Nukopijuota';
        window.clearTimeout(button.resetTimer);
        button.resetTimer = window.setTimeout(() => {
          button.replaceChildren(...labels);
        }, 2500);
      } catch {
        // No clipboard access: show it so it can be copied by hand.
        window.prompt(ask, value());
      }
    });
  }
  copyButton('call-copy', inviteUrl, 'Nukopijuok susitikimo nuorodą:');
  copyButton('call-copy-code', () => formatMeetingCode(code), 'Nukopijuok susitikimo kodą:');

  // Closing the tab or moving to another page: tell the database right away
  // (otherwise it notices after 30 seconds) and let the camera go.
  window.addEventListener('pagehide', () => {
    if (phase !== 'call' && phase !== 'waiting') return;
    const current = session();
    const { supabaseUrl, supabaseKey } = backendConfig();
    peers.forEach((peer) => {
      try {
        if (peer.channel && peer.channel.readyState === 'open') peer.channel.send('{"t":"bye"}');
      } catch {
        // Nothing more to do.
      }
    });
    if (current && supabaseUrl) {
      try {
        fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/meeting_leave`, {
          method: 'POST',
          keepalive: true,
          headers: { apikey: supabaseKey, Authorization: `Bearer ${current.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_code: code, p_conn: conn }),
        }).catch(() => {});
      } catch {
        // The database notices by itself.
      }
    }
    [media.mic, media.cam, media.screen].forEach((track) => {
      if (track) track.stop();
    });
  });
  // Back from the browser's page cache with a call that is no longer there.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) window.location.reload();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (phase === 'call') keepScreenOn();
    if (phase === 'call' || phase === 'waiting') syncSoon(0);
  });
  // The hourly login renewal: pass the new login on to the nudge channel.
  window.setInterval(() => nudges.refresh(), 30000);

  // --- Which screen to show --------------------------------------------------

  // --- Being late to a lesson at an agreed time ------------------------------
  //
  // From 10 minutes after the start, the student who came may call the
  // lesson off. From 15 minutes, a countdown says it ends in 60 seconds; the
  // database ends it then, unless the other student arrives meanwhile.

  // Why a lesson ended because of being late, in words.
  function lateText(late, name) {
    if (late === 'me') return 'Pamoka baigta, nes vėlavai daugiau nei leidžiama.';
    if (late === 'them') return `Pamoka baigta, nes ${name || 'kitas moksleivis'} vėlavo daugiau nei 15 minučių.`;
    return 'Pamoka neįvyko, nes per 15 minučių niekas neprisijungė.';
  }

  const lateBox = $('call-late');
  const lateText_ = $('call-late-text');
  const lateCancel = $('call-late-cancel');
  const lateDialog = $('late-dialog');

  function lateTick() {
    if (!lessonMode || !lateBox) return;
    const wasHidden = lateBox.hidden;
    lateUpdate();
    // The notice takes room above the pictures: size them again.
    if (lateBox.hidden !== wasHidden) measure();
  }

  function lateUpdate() {
    const watch = phase === 'call' && lesson && lesson.startsAt && !lesson.partnerJoined;
    if (!watch) {
      lateBox.hidden = true;
      return;
    }
    const now = Date.now() + lesson.offset;
    const late = now - lesson.startsAt;
    const name = lesson.partner.name;
    if (late >= 15 * 60000) {
      const left = Math.max(0, Math.ceil((lesson.startsAt + 16 * 60000 - now) / 1000));
      lateText_.textContent = `${name} vėluoja daugiau nei 15 minučių, todėl pamoka baigsis po ${left} s.`;
      lateCancel.hidden = true;
      lateBox.hidden = false;
      // The database ends it at that moment; ask it right away.
      if (left === 0) syncSoon(0);
    } else if (late >= 10 * 60000) {
      lateText_.textContent = `${name} vėluoja jau ${Math.floor(late / 60000)} min. Gali atšaukti pamoką.`;
      lateCancel.hidden = false;
      lateBox.hidden = false;
    } else {
      lateBox.hidden = true;
    }
  }
  if (lessonMode && lateBox) window.setInterval(lateTick, 1000);

  // The lesson's time. It ends at endsAt (for a lesson right now, the
  // database only knows that once both students are in, so it is asked
  // every 15 seconds until then). After the end a notice counts down 5
  // minutes; then the database ends the call for both.
  const timeBox = $('call-time');
  const timeText = $('call-time-text');
  let timingAsked = 0;

  async function askTiming() {
    timingAsked = Date.now();
    const res = await meetingRpc('lesson_timing', { p_lesson: lessonId });
    if (res.ok && lesson) {
      lesson.endsAt = res.ends_at ? Date.parse(res.ends_at) : null;
      if (res.now) lesson.offset = Date.parse(res.now) - Date.now();
    }
  }

  function timeTick() {
    if (!lessonMode || !timeBox || !lesson) return;
    const wasHidden = timeBox.hidden;
    if (phase !== 'call') {
      timeBox.hidden = true;
    } else {
      if (!lesson.endsAt && Date.now() - timingAsked > 15000) askTiming();
      const now = Date.now() + lesson.offset;
      if (lesson.endsAt && now >= lesson.endsAt) {
        const left = Math.max(0, Math.ceil((lesson.endsAt + MEET_LESSON_GRACE_MS - now) / 1000));
        const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        timeText.textContent = `Pamokos laikas baigėsi. Po ${clock} pamoka bus automatiškai užbaigta.`;
        timeBox.hidden = false;
        // The database ends it at that moment; ask it right away.
        if (left === 0) syncSoon(0);
      } else {
        timeBox.hidden = true;
      }
    }
    // The notice takes room above the pictures: size them again.
    if (timeBox.hidden !== wasHidden) measure();
  }
  if (lessonMode && timeBox) window.setInterval(timeTick, 1000);

  // --- Sound during a lesson (supabase/updates/2026-12-01-lesson-sound.sql) ---
  // Every quarter second: does this student's microphone pick up any sound?
  // It is measured on the real microphone, so an unplugged or wrong
  // microphone counts as silence even when the site shows it as on; muted
  // sends nothing, so it counts as silence too. Every 30 seconds only yes or
  // no goes to the database, never anything that was said. The camera is not
  // checked. A lesson only counts when there was sound in most of it.
  const SOUND_LEVEL = 0.02; // loudness (0-1) that counts as sound
  const SOUND_REPORT_MS = 30000;
  const SOUND_MIN_WINDOWS = 6; // 1.5 s of sound in 30 s
  let soundMeter = null; // { track, source, analyser, samples }
  let soundWindows = 0;
  let soundReportAt = 0;
  let silentReports = 0;
  let silenceWarnedAt = 0;

  function dropSoundMeter() {
    if (!soundMeter) return;
    try {
      soundMeter.source.disconnect();
    } catch {
      // Already gone.
    }
    soundMeter = null;
  }

  function soundAnalyser() {
    const track = media.mic;
    if (!track || track.readyState !== 'live') {
      dropSoundMeter();
      return null;
    }
    if (soundMeter && soundMeter.track === track) return soundMeter;
    dropSoundMeter();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      audioContext = audioContext || new AudioContextClass();
      const source = audioContext.createMediaStreamSource(new MediaStream([track]));
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      soundMeter = { track, source, analyser, samples: new Uint8Array(analyser.fftSize) };
      return soundMeter;
    } catch {
      return null;
    }
  }

  function soundTick() {
    if (!lessonMode || phase !== 'call' || !lesson) {
      soundReportAt = 0;
      soundWindows = 0;
      return;
    }
    const now = Date.now();
    if (!soundReportAt) soundReportAt = now + SOUND_REPORT_MS;
    if (media.micOn) {
      const meter = soundAnalyser();
      if (meter) {
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        meter.analyser.getByteTimeDomainData(meter.samples);
        let sum = 0;
        for (let i = 0; i < meter.samples.length; i += 1) {
          const v = (meter.samples[i] - 128) / 128;
          sum += v * v;
        }
        if (Math.sqrt(sum / meter.samples.length) > SOUND_LEVEL) soundWindows += 1;
      }
    }
    if (now < soundReportAt) return;
    const had = soundWindows >= SOUND_MIN_WINDOWS;
    soundWindows = 0;
    soundReportAt = now + SOUND_REPORT_MS;
    meetingRpc('lesson_sound_report', { p_lesson: lessonId, p_sound: had });
    // Silent for 3 minutes while the lesson's time runs: say so (at most
    // every 5 minutes), so a dead or wrong microphone is noticed in time.
    silentReports = had ? 0 : silentReports + 1;
    const clock = now + lesson.offset;
    const running = lesson.endsAt && clock < lesson.endsAt;
    if (running && silentReports >= 6 && now - silenceWarnedAt > 5 * 60000) {
      silenceWarnedAt = now;
      toast(media.micOn
        ? 'Tavo mikrofonas jau 3 minutes negirdi jokio garso. Patikrink nustatymuose, ar pasirinktas tinkamas mikrofonas: pamoka užskaitoma tik tada, kai kalbatės.'
        : 'Tavo mikrofonas išjungtas jau 3 minutes. Pamoka užskaitoma tik tada, kai kalbatės.', 10000);
    }
  }
  if (lessonMode) window.setInterval(soundTick, 250);

  // A lesson that wasn't counted because it was too quiet: its last screen.
  async function quietEnding() {
    const res = await meetingRpc('lesson_quiet', { p_lesson: lessonId });
    if (!res.ok || res.quiet !== true) return null;
    return {
      title: 'Pamoka neužskaityta',
      text: 'Didžiąją pamokos dalį mikrofonuose nebuvo girdėti jokio garso, todėl taškai ir socialinės valandos už ją neskiriami. Pamoka užskaitoma, kai bent pusę jos laiko girdėti kalba ir kalba abu.',
    };
  }

  if (lateCancel) {
    lateCancel.addEventListener('click', () => askToConfirm({
      title: 'Atšaukti pamoką?',
      text: `${lesson.partner.name} vis dar neprisijungė. Pamoka bus baigta.`,
      ok: 'Atšaukti pamoką',
      run: async () => {
        const result = await meetingRpc('lesson_cancel', { p_lesson: lessonId });
        if (result.ok) finish('late_cancel', { ending: { title: 'Pamoka atšaukta', text: `${lesson.partner.name} neprisijungė.` } });
        return result;
      },
    }));
  }

  // The last screen of a finished lesson.
  function finishedEnding(res) {
    const name = res.partner && res.partner.name;
    return {
      title: 'Pamoka įvyko',
      // "Pamoka: Ona Onaitė" rather than "su Ona Onaitė", which would need
      // the name in another case.
      text: name ? `Ačiū už pamoką! ${res.i_teach ? 'Mokinys' : 'Mokytojas'}: ${name}.` : 'Ačiū už pamoką!',
      rewards: res,
    };
  }

  // The lesson's call ended: find out whether it was because of being late,
  // and whether it counted as finished (and the points it gave).
  async function lessonEnded() {
    const res = await meetingRpc('lesson_open', { p_lesson: lessonId });
    if (res.error === 'over' && res.finished === true) {
      finish('ended', { ending: finishedEnding(res) });
      return;
    }
    if (res.error === 'late') {
      const text = lateText(res.late, lesson && lesson.partner.name);
      finish('late', { ending: { title: 'Pamoka baigta', text } });
      if (lateDialog) {
        $('late-dialog-text').textContent = text;
        lateDialog.showModal();
      }
      return;
    }
    if (res.error === 'over') {
      const quiet = await quietEnding();
      if (quiet) {
        finish('ended', { ending: quiet });
        return;
      }
    }
    finish('ended');
  }

  // A lesson's page: ask the database for the call of this lesson. It only
  // answers the lesson's own two students, and only once the lesson is open.
  async function openLesson() {
    window.MokifyHere = { lesson: lessonId };
    setPhase('lobby');
    lobbyTitle.textContent = 'Kraunama…';
    [lobbyHost, lobbyStatus, lobbyJoin, lobbyCancel].forEach((el) => { el.hidden = true; });
    showBanner(lobbyError, '');
    const res = UUID_PATTERN.test(lessonId) ? await meetingRpc('lesson_open', { p_lesson: lessonId }) : { ok: false, error: 'not_found' };
    if (res.ok && MEET_CODE_PATTERN.test(res.code || '') && res.partner) {
      lesson = {
        i_teach: res.i_teach === true,
        partner: { id: res.partner.id, name: String(res.partner.name || ''), avatar: res.partner.avatar },
        // For a lesson at an agreed time: when it starts, whether the other
        // student has come yet, and how far this computer's clock is off
        // the database's (for counting minutes late).
        startsAt: res.starts_at ? Date.parse(res.starts_at) : null,
        partnerJoined: res.partner_joined === true,
        offset: res.now ? Date.parse(res.now) - Date.now() : 0,
        // When the lesson's time ends (empty until both are in a "now" lesson).
        endsAt: res.ends_at ? Date.parse(res.ends_at) : null,
      };
      // Back to this very chat afterwards.
      if (UUID_PATTERN.test(lesson.partner.id || '')) {
        [lobbyBack, $('done-home')].forEach((link) => { link.href = `zinutes.html?su=${lesson.partner.id}`; });
      }
      openLobby(res.code);
      return;
    }
    if (res.error === 'signed_out') {
      toLogin();
      return;
    }
    // A finished lesson opened again (e.g. from the chat): its results.
    if (res.error === 'over' && res.finished === true) {
      if (res.partner && UUID_PATTERN.test(res.partner.id || '')) $('done-home').href = `zinutes.html?su=${res.partner.id}`;
      finish('ended', { ending: finishedEnding(res) });
      return;
    }
    lobbyTitle.textContent = 'Pamoka';
    let message = MEET_ERRORS[res.error] || MEET_ERRORS.failed;
    if (res.error === 'early') {
      const at = new Date(res.starts_at);
      const when = Number.isNaN(at.getTime()) ? '' : ` (${at.toLocaleString('lt-LT', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })})`;
      message = `Ši pamoka dar neprasidėjo${when}. Prisijungti galėsi likus 10 minučių iki jos pradžios.`;
    } else if (res.error === 'late') message = lateText(res.late, res.partner && res.partner.name);
    else if (res.error === 'over' || res.error === 'ended') {
      const points = Number(res.points) || 0;
      message = points ? `Ši pamoka jau baigėsi. Už ją gavai ${points} ${pluralLt(points, 'tašką', 'taškus', 'taškų')}.` : 'Ši pamoka jau baigėsi.';
      if (res.error === 'over' && !points) {
        const quiet = await quietEnding();
        if (quiet) message = `Ši pamoka jau baigėsi ir buvo neužskaityta: ${quiet.text.charAt(0).toLowerCase()}${quiet.text.slice(1)}`;
      }
    }
    else if (res.error === 'cancelled') message = 'Ši pamoka atšaukta.';
    else if (res.error === 'not_agreed') message = 'Dėl šios pamokos laiko dar nesusitarta.';
    else if (res.error === 'not_found') message = 'Tokios pamokos nėra. Pamokas rasi savo žinutėse.';
    else if (res.error === 'refused') message = 'Prie šios pamokos prisijungti negali.';
    else if (res.error === 'inactive') message = endings.inactive.text;
    showBanner(lobbyError, message);
    lobbyTitle.focus();
  }

  function route() {
    if (lessonMode) {
      openLesson();
      return;
    }
    const raw = new URLSearchParams(window.location.search).get('k');
    const wanted = raw ? meetingCodeFrom(raw) : null;
    if (wanted) {
      openLobby(wanted);
      return;
    }
    code = null;
    openHome();
    if (raw) showBanner(homeError, MEET_ERRORS.not_found);
  }

  // The browser's Back and Forward buttons.
  window.addEventListener('popstate', async () => {
    if (phase === 'call' || phase === 'waiting') await finish('left', { tellServer: true, silent: true });
    else stopMedia();
    route();
  });

  // This student's own name and picture: what the menu already remembers
  // right away, then fresh from the database.
  const useProfile = (profile) => {
    if (!profile) return;
    me = { id: me.id, name: profile.full_name || '', avatar: meetingAvatar(profile.avatar) };
    $('lobby-avatar').src = me.avatar;
    if (selfTile) selfTile.img.src = me.avatar;
  };
  useProfile(readCachedProfile());
  getSession().then((current) => {
    if (!current) {
      if (!readSession()) toLogin();
      return;
    }
    fetchOwnProfile(current).then(useProfile);
  });

  localMediaChanged();
  route();
}
