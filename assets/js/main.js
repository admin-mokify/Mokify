// Mokify — shared front-end behaviour (no build step, progressively enhanced)

document.addEventListener('DOMContentLoaded', () => {
  trackActivity();
  initAccountHeader();
  initMobileNav();
  initPasswordToggles();
  initRoleSwitch();
  initSectionReveal();
  initTransparentHeader();
  initFaqAccordion();
  initFaqSearch();
  initMailtoCopyFallback();
  initRegistrationForm();
  initLoginForm();
  initAccountPage();
  initTeacherForm();
});

function initMobileNav() {
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.querySelector('.mobile-menu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    // Relax the header's full pill radius while the dropdown is open, so the
    // now-tall island reads as a rounded panel instead of a stretched capsule.
    header?.classList.toggle('nav-open', isOpen);
  });

  menu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      header?.classList.remove('nav-open');
    });
  });
}

function initPasswordToggles() {
  document.querySelectorAll('.password-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.password-field')?.querySelector('input');
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-pressed', String(!showing));
      btn.setAttribute('aria-label', showing ? 'Rodyti slaptažodį' : 'Slėpti slaptažodį');
    });
  });
}

function initRoleSwitch() {
  document.querySelectorAll('.role-switch').forEach((group) => {
    const buttons = group.querySelectorAll('button');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => b.setAttribute('aria-selected', 'false'));
        btn.setAttribute('aria-selected', 'true');
        const event = new CustomEvent('role-change', { detail: btn.dataset.role });
        group.dispatchEvent(event);
      });
    });
  });
}

function initTransparentHeader() {
  const header = document.querySelector('.site-header--transparent');
  if (!header) return;

  const onScroll = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 40);
  };

  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

// Each <section>'s reveal elements track a continuous --reveal-progress
// (0-1) instead of a binary on/off: it's how much of that section is
// currently visible (0 = just touching the viewport edge, 1 = the whole
// section — or as much of it as can fit — is on screen). A light scroll
// that only grazes a section barely nudges it in; scrolling until the
// whole section is showing brings it fully in. Set on the <section> via
// a scroll/resize-driven rAF loop, it inherits down into every
// [data-reveal] descendant, so this is O(sections) per frame, not
// O(reveal elements).
function initSectionReveal() {
  const allTargets = document.querySelectorAll('[data-reveal], [data-reveal-draw]');
  if (!allTargets.length) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    allTargets.forEach((el) => el.style.setProperty('--reveal-progress', 1));
    return;
  }

  const sections = Array.from(document.querySelectorAll('main > section'));
  if (!sections.length) {
    // No <section> wrappers on this page (e.g. the 404 shell) — nothing to
    // scrub against, so just reveal everything once.
    allTargets.forEach((el) => el.style.setProperty('--reveal-progress', 1));
    return;
  }

  let ticking = false;

  const updateProgress = () => {
    ticking = false;
    const viewportHeight = window.innerHeight;
    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
      const denom = Math.min(rect.height, viewportHeight) || 1;
      const linear = Math.min(1, Math.max(0, visibleHeight / denom));
      // Cubic ease-in: raw visibility climbs roughly linearly, but a
      // section barely poking into view (e.g. 50% visible) should still
      // read as clearly hidden, not already half-revealed — this keeps
      // early progress small and saves the dramatic reveal for once the
      // section is substantially on screen.
      const eased = linear * linear * linear;
      section.style.setProperty('--reveal-progress', eased.toFixed(3));
    });
  };

  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateProgress);
  };

  updateProgress();
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
}

function initFaqAccordion() {
  const triggers = document.querySelectorAll('.faq-trigger');
  if (!triggers.length) return;

  triggers.forEach((trigger) => {
    const panel = document.getElementById(trigger.getAttribute('aria-controls'));
    if (!panel) return;

    trigger.addEventListener('click', () => {
      const isOpen = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!isOpen));
      panel.style.maxHeight = isOpen ? '0px' : `${panel.scrollHeight}px`;
    });
  });

  window.addEventListener('resize', () => {
    triggers.forEach((trigger) => {
      if (trigger.getAttribute('aria-expanded') !== 'true') return;
      const panel = document.getElementById(trigger.getAttribute('aria-controls'));
      if (panel) panel.style.maxHeight = `${panel.scrollHeight}px`;
    });
  });
}

// Live search over the D.U.K. accordion: as the visitor types, shows up to
// five matching questions in a dropdown; picking one opens that accordion
// item and scrolls it into view. Matches against the question, the answer,
// and each item's data-keywords attribute (unseen synonyms an editor can
// add in the HTML, e.g. "kaina, pinigai" on the pricing question), so a
// visitor's wording doesn't have to appear verbatim — but the dropdown only
// ever lists question titles.
function initFaqSearch() {
  const input = document.getElementById('faq-search-input');
  const resultsList = document.getElementById('faq-search-results');
  const searchWrap = input?.closest('.faq-search');
  if (!input || !resultsList || !searchWrap) return;

  const entries = Array.from(document.querySelectorAll('.faq-item')).map((item) => {
    const trigger = item.querySelector('.faq-trigger');
    const questionText = trigger?.querySelector('span')?.textContent.trim() || '';
    const answerText = item.querySelector('.faq-answer-inner')?.textContent.trim() || '';
    const keywords = item.dataset.keywords || '';
    return { item, trigger, questionText, searchText: `${questionText} ${answerText} ${keywords}`.toLowerCase() };
  }).filter((entry) => entry.trigger && entry.questionText);

  let activeIndex = -1;
  let currentMatches = [];

  const closeResults = () => {
    resultsList.hidden = true;
    resultsList.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
    currentMatches = [];
  };

  const openEntry = (entry) => {
    if (entry.trigger.getAttribute('aria-expanded') !== 'true') entry.trigger.click();
    entry.item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    entry.trigger.focus();
  };

  const setActive = (index) => {
    const options = resultsList.querySelectorAll('.faq-search-result');
    options.forEach((opt) => opt.classList.remove('is-active'));
    activeIndex = index;
    if (index >= 0 && options[index]) {
      options[index].classList.add('is-active');
      input.setAttribute('aria-activedescendant', `faq-search-option-${index}`);
      options[index].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const renderResults = (matches) => {
    currentMatches = matches;
    activeIndex = -1;
    resultsList.innerHTML = '';

    if (!matches.length) {
      const empty = document.createElement('li');
      empty.className = 'faq-search-empty';
      empty.setAttribute('role', 'presentation');
      empty.textContent = 'Nieko nerasta.';
      resultsList.appendChild(empty);
      resultsList.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      return;
    }

    matches.forEach((entry, index) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = `faq-search-option-${index}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'faq-search-result';
      btn.textContent = entry.questionText;
      btn.addEventListener('click', () => {
        openEntry(entry);
        closeResults();
        input.value = '';
      });

      li.appendChild(btn);
      resultsList.appendChild(li);
    });

    resultsList.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const runSearch = () => {
    const query = input.value.trim().toLowerCase();
    if (!query) {
      closeResults();
      return;
    }
    renderResults(entries.filter((entry) => entry.searchText.includes(query)).slice(0, 5));
  };

  input.addEventListener('input', runSearch);

  input.addEventListener('keydown', (e) => {
    if (resultsList.hidden || !currentMatches.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((activeIndex + 1) % currentMatches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((activeIndex - 1 + currentMatches.length) % currentMatches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openEntry(currentMatches[activeIndex >= 0 ? activeIndex : 0]);
      closeResults();
      input.value = '';
    } else if (e.key === 'Escape') {
      closeResults();
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchWrap.contains(e.target)) closeResults();
  });
}

// A plain `mailto:` link only does something visible if the visitor's OS/
// browser has a default mail app registered — otherwise a normal click is
// silently a no-op. This adds a copy-to-clipboard fallback so the button is
// still useful either way, without changing the link's native behaviour.
function initMailtoCopyFallback() {
  document.querySelectorAll('a.btn[href^="mailto:"]').forEach((link) => {
    const originalLabel = link.textContent;
    const email = link.getAttribute('href').slice('mailto:'.length).split('?')[0];

    link.addEventListener('click', () => {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(email).then(() => {
        link.textContent = 'Adresas nukopijuotas ✓';
        window.clearTimeout(link._resetTimer);
        link._resetTimer = window.setTimeout(() => {
          link.textContent = originalLabel;
        }, 2000);
      }).catch(() => {});
    });
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const DEFAULT_AVATAR = 'assets/img/default-avatar.svg';

const NAME_PATTERN = /^\p{L}[\p{L}'’-]*(\s+\p{L}[\p{L}'’-]*)+$/u;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_PATTERN = /^\d{6,10}$/;
// School access codes: 8 characters without 0/O/1/I/L, shown as MOK-XXXX-XXXX.
const ACCESS_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{8}$/;

// NFC so letters typed or pasted in decomposed form (base letter + combining
// mark, common from macOS/iOS and copy-paste) still count as one letter.
const normalizeName = (v) => v.normalize('NFC').trim().replace(/\s+/g, ' ');

const isValidPassword = (v) => v.length >= 8 && v.length <= 72 && /\p{L}/u.test(v) && /\d/.test(v);

const USERNAME_TAKEN_MSG = 'Šis vartotojo vardas jau užimtas.';
const EMAIL_TAKEN_MSG = 'Su šiuo el. paštu paskyra jau sukurta.';
const PASSWORD_RULE_MSG = 'Slaptažodis turi būti bent 8 simbolių ir turėti raidę bei skaičių.';
const BAD_CODE_MSG = 'Neteisingas arba pasibaigęs kodas.';
const SAVE_FAILED_MSG = 'Nepavyko sukurti paskyros. Pabandyk dar kartą.';
const NETWORK_FAILED_MSG = 'Nepavyko prisijungti prie serverio. Patikrink ryšį ir pabandyk dar kartą.';
const UNAVAILABLE_MSG = 'Registracija šiuo metu neprieinama.';
const RATE_LIMITED_MSG = 'Per daug bandymų. Palauk minutę ir pabandyk dar kartą.';
const FULL_NAME_RULE_MSG = 'Įvesk savo vardą ir pavardę (be skaičių ir simbolių).';
const USERNAME_RULE_MSG ='Naudok 3–20 simbolių: raides be diakritikų, skaičius, „_“ arba „.“.';
const BIO_MAX_LENGTH = 300;
const BIO_TOO_LONG_MSG = `Aprašymas gali būti iki ${BIO_MAX_LENGTH} simbolių.`;
const LOGIN_FAILED_MSG ='Neteisingas vartotojo vardas arba slaptažodis.';
const LOGIN_LOCKED_MSG = 'Per daug neteisingų bandymų. Pabandyk vėl po 15 minučių.';
const RESEND_COOLDOWN_SECONDS = 60;

const ACCESS_CODE_MESSAGES = {
  format: 'Kodas turi atrodyti taip: MOK-XXXX-XXXX.',
  invalid: 'Tokio kodo nėra. Patikrink, ar įvedei teisingai.',
  used: 'Šis kodas jau panaudotas. Kreipkis į savo mokyklą.',
  expired: 'Tavo mokyklos Mokify prenumerata pasibaigė. Kreipkis į savo mokyklą.',
};

// Same rules as public.normalize_access_code in supabase/schema.sql.
function normalizeAccessCode(value) {
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^MOK.{8}$/.test(code) ? code.slice(3) : code;
}

const formatAccessCode = (code) => `MOK-${code.slice(0, 4)}-${code.slice(4)}`;

// Supabase connection details come from assets/js/config.js.
const backendConfig = () => window.MOKIFY_CONFIG || {};

// Resolves to { ok, status, data }. status 0 means the request never got an
// answer (offline, blocked, or no connection details configured).
async function callApi(path, { method = 'POST', body, token, prefer } = {}) {
  const { supabaseUrl, supabaseKey } = backendConfig();
  if (!supabaseUrl || !supabaseKey) return { ok: false, status: 0, data: {}, unconfigured: true };

  const headers = { apikey: supabaseKey, 'Content-Type': 'application/json' };
  // Legacy anon keys are JWTs and may double as the bearer token; the newer
  // "publishable" keys are not JWTs and must only be sent as `apikey`.
  const bearer = token || (supabaseKey.startsWith('eyJ') ? supabaseKey : null);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (prefer) headers.Prefer = prefer;

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

// --- Signed-in session, kept in this browser so students stay logged in ---
const SESSION_KEY = 'mokify.session';

function saveSession(data) {
  if (!data || !data.access_token || !data.user) return;
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user.id, email: data.user.email },
    last_active: Date.now(),
  };
  try {
    // A different student logging in on this browser: forget the last one's picture.
    if (readSession()?.user?.id !== session.user.id) localStorage.removeItem(PROFILE_KEY);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage blocked (e.g. some private windows): the student just has to log in again later.
  }
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

// Ends the login on the server too, so the stored tokens stop working even if
// someone copied them. Only this browser is logged out (scope=local); the
// account itself is untouched.
async function revokeSession(session) {
  let token = session.access_token;
  if (session.expires_at - 60 <= Date.now() / 1000) {
    const res = await callApi('/auth/v1/token?grant_type=refresh_token', {
      body: { refresh_token: session.refresh_token },
    });
    if (!res.ok) return; // Already unusable.
    token = res.data.access_token;
  }
  await callApi('/auth/v1/logout?scope=local', { token });
}

async function signOut() {
  const session = readSession();
  clearSession();
  if (session) await revokeSession(session);
}

// Logged out after 72 hours without opening the site. The time of the last
// visit is stored with the session and updated on every page load and
// whenever the tab is brought back into view.
const INACTIVITY_LIMIT_MS = 72 * 60 * 60 * 1000;

function trackActivity() {
  const check = () => {
    const session = readSession();
    if (!session) return;
    if (Date.now() - (session.last_active || Date.now()) > INACTIVITY_LIMIT_MS) {
      clearSession();
      revokeSession(session);
      return;
    }
    session.last_active = Date.now();
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Storage blocked: nothing to update.
    }
  };

  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const wasSignedIn = Boolean(readSession());
    check();
    // Logged out while the tab sat in the background: show the page as a guest.
    if (wasSignedIn && !readSession()) window.location.reload();
  });
}

// Name and picture for the header, remembered so pages don't flash the
// default picture while the profile loads.
const PROFILE_KEY = 'mokify.profile';

function readCachedProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY));
  } catch {
    return null;
  }
}

async function fetchOwnProfile(session) {
  const res = await callApi(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=full_name,username,email,grade,avatar,bio`,
    { method: 'GET', token: session.access_token },
  );
  const profile = res.ok && Array.isArray(res.data) ? res.data[0] : null;
  if (profile) {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // Too big or storage blocked: it is simply fetched again next time.
    }
  }
  return profile;
}

// The stored session, renewed first when its access token is about to expire
// (they last an hour). null when nobody is logged in or it can't be renewed.
async function getSession() {
  const session = readSession();
  if (!session || !session.refresh_token) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session;

  const res = await callApi('/auth/v1/token?grant_type=refresh_token', {
    body: { refresh_token: session.refresh_token },
  });
  if (res.ok) {
    saveSession(res.data);
    return readSession();
  }
  // Offline: keep it and try again later. Otherwise the login has ended.
  if (res.status !== 0) clearSession();
  return null;
}

// Every page: once logged in, the header shows an account button (picture +
// "Paskyra") in place of "Prisijungti / Pradėti". The stored session is
// trusted right away so there's no flicker, then checked with the server.
function initAccountHeader() {
  const actions = document.querySelector('.nav-actions');
  if (!actions || !readSession()) return;

  const root = document.documentElement;
  const cached = readCachedProfile();
  const link = document.createElement('a');
  link.className = 'nav-account';
  link.href = 'paskyra.html';
  link.setAttribute('aria-label', 'Mano paskyra');
  link.innerHTML = '<img alt="" width="34" height="34"><span>Paskyra</span>';
  const img = link.querySelector('img');
  img.src = (cached && cached.avatar) || DEFAULT_AVATAR;
  actions.insertBefore(link, actions.querySelector('.nav-toggle'));

  document.querySelectorAll('.mobile-menu a[href="prisijungti.html"], .mobile-menu a[href="registracija.html"]')
    .forEach((a) => a.classList.add('guest-only'));
  root.classList.add('signed-in');

  // Buttons like the home page's "Pradėti" lead to the account page instead.
  const memberLinks = document.querySelectorAll('[data-member-href]');
  memberLinks.forEach((a) => {
    a.dataset.guestHref = a.getAttribute('href');
    a.setAttribute('href', a.dataset.memberHref);
  });

  getSession().then(async (session) => {
    if (!session) {
      // The login ended (e.g. signed out elsewhere): back to the guest header.
      if (!readSession()) {
        link.remove();
        root.classList.remove('signed-in');
        memberLinks.forEach((a) => a.setAttribute('href', a.dataset.guestHref));
      }
      return;
    }
    const profile = await fetchOwnProfile(session);
    if (profile && profile.avatar) img.src = profile.avatar;
  });
}

// Failure shapes used by every step: { ok: false, errors: { field: message } }
// for problems tied to a field, { ok: false, formError } for everything else.
function failureFrom(res) {
  if (res.unconfigured) return { ok: false, formError: UNAVAILABLE_MSG };
  if (res.status === 0) return { ok: false, formError: NETWORK_FAILED_MSG };
  if (res.status === 429 || /rate_limit/.test(res.data.error_code || '')) {
    return { ok: false, formError: RATE_LIMITED_MSG };
  }
  console.error('Registration request failed', res.status, res.data);
  return { ok: false, formError: SAVE_FAILED_MSG };
}

// true / false, or null when the answer could not be obtained.
async function checkUsernameAvailable(username) {
  const res = await callApi('/rest/v1/rpc/username_available', { body: { p_username: username } });
  return res.ok && typeof res.data === 'boolean' ? res.data : null;
}

// 'valid' | 'used' | 'expired' | 'invalid' on success, otherwise a failure.
async function checkAccessCode(code) {
  const res = await callApi('/rest/v1/rpc/access_code_status', { body: { p_code: code } });
  if (res.ok && typeof res.data === 'string') return { ok: true, status: res.data };
  const failure = failureFrom(res);
  if (failure.formError === SAVE_FAILED_MSG) failure.formError = 'Nepavyko patikrinti kodo. Pabandyk dar kartą.';
  return failure;
}

async function signUpUser(data) {
  const res = await callApi('/auth/v1/signup', {
    body: {
      email: data.email.toLowerCase(),
      password: data.password,
      data: {
        full_name: data.fullName,
        username: data.username,
        grade: Number(data.grade),
        bio: data.bio,
        access_code: data.accessCode,
      },
    },
  });

  if (!res.ok) {
    const code = res.data.error_code || '';
    if (code === 'weak_password') return { ok: false, errors: { password: PASSWORD_RULE_MSG } };
    if (code === 'user_already_exists' || code === 'email_exists') return { ok: false, errors: { email: EMAIL_TAKEN_MSG } };
    if (code === 'email_address_invalid') return { ok: false, errors: { email: 'Įvesk teisingą el. pašto adresą.' } };
    // The database refuses the sign-up when the code stopped being usable after
    // it was checked (someone else used it, or the subscription just ended).
    if (res.status === 500) {
      const check = await checkAccessCode(data.accessCode);
      if (check.ok && check.status !== 'valid') return { ok: false, accessCodeError: ACCESS_CODE_MESSAGES[check.status] };
    }
    return failureFrom(res);
  }

  // For an email that is already registered and confirmed, Supabase answers
  // 200 with a user that has no identities (so sign-up can't be used to probe
  // which emails exist). That is our "email taken" signal.
  const user = res.data.user || res.data;
  if (Array.isArray(user.identities) && user.identities.length === 0) {
    return { ok: false, errors: { email: EMAIL_TAKEN_MSG } };
  }
  // A session in the answer means the project has email confirmation switched off.
  return { ok: true, session: res.data.access_token ? res.data : null };
}

// Supabase logs in with an email, so the database first swaps the username
// for the account's email (public.login_email, which only answers when the
// password is right too). Typing the email itself also works.
async function signInUser(login, password) {
  let email = login;
  if (!login.includes('@')) {
    const lookup = await callApi('/rest/v1/rpc/login_email', { body: { p_username: login, p_password: password } });
    if (!lookup.ok) return failureFrom(lookup);
    if (lookup.data.status === 'locked') return { ok: false, formError: LOGIN_LOCKED_MSG };
    if (lookup.data.status !== 'ok') return { ok: false, formError: LOGIN_FAILED_MSG };
    email = lookup.data.email;
  }

  const res = await callApi('/auth/v1/token?grant_type=password', {
    body: { email: email.toLowerCase(), password },
  });
  if (res.ok) return { ok: true, session: res.data };
  const code = res.data.error_code || '';
  if (code === 'email_not_confirmed') return { ok: false, unconfirmed: true, email };
  if (code === 'invalid_credentials' || res.status === 400) return { ok: false, formError: LOGIN_FAILED_MSG };
  return failureFrom(res);
}

async function verifyEmailCode(email, code) {
  const res = await callApi('/auth/v1/verify', { body: { type: 'signup', email: email.toLowerCase(), token: code } });
  if (res.ok) return { ok: true, session: res.data };
  if (res.status === 429 || res.status === 0 || res.unconfigured) return failureFrom(res);
  return { ok: false, errors: { code: BAD_CODE_MSG } };
}

async function resendEmailCode(email) {
  const res = await callApi('/auth/v1/resend', { body: { type: 'signup', email: email.toLowerCase() } });
  return res.ok ? { ok: true } : failureFrom(res);
}

// The picture is chosen before the email is confirmed, but the profile row only
// exists (and is only writable) afterwards, so it is saved with the new session.
async function saveAvatar(session, avatar) {
  const res = await callApi(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}`, {
    method: 'PATCH',
    token: session.access_token,
    prefer: 'return=minimal',
    body: { avatar },
  });
  return res.ok;
}

// Saves picture, username and description from the account page.
async function updateProfile(session, changes) {
  const res = await callApi(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}`, {
    method: 'PATCH',
    token: session.access_token,
    prefer: 'return=representation',
    body: changes,
  });
  if (res.ok && Array.isArray(res.data) && res.data[0]) return { ok: true, profile: res.data[0] };
  if (res.data.code === '23505') return { ok: false, errors: { username: USERNAME_TAKEN_MSG } };
  if (res.data.code === '23514' && 'full_name' in changes) return { ok: false, errors: { fullName: FULL_NAME_RULE_MSG } };
  if (res.status === 0 || res.status === 429 || res.unconfigured) return failureFrom(res);
  console.error('Profile update failed', res.status, res.data);
  return { ok: false, formError: 'Nepavyko išsaugoti pakeitimų. Pabandyk dar kartą.' };
}

// Center-crops to a square and downsizes, so the stored picture stays small
// (a few KB) no matter how large the uploaded photo is.
function resizeToSquare(file, size) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(
        img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        0, 0, size, size
      );
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

// Profile picture chooser (#avatar-input, #avatar-preview, #avatar-pick,
// #avatar-remove, #avatar-error), used on sign-up and on the account page.
// value is a small JPEG data URL, or null for the default picture.
function createAvatarPicker() {
  const input = document.getElementById('avatar-input');
  const preview = document.getElementById('avatar-preview');
  const pickBtn = document.getElementById('avatar-pick');
  const removeBtn = document.getElementById('avatar-remove');
  const field = input.closest('.field');
  const errorEl = document.getElementById('avatar-error');
  let value = null;

  const setError = (message) => {
    field.classList.toggle('has-error', Boolean(message));
    errorEl.textContent = message;
  };

  const show = (dataUrl) => {
    value = dataUrl;
    input.value = '';
    preview.src = dataUrl || DEFAULT_AVATAR;
    removeBtn.hidden = !dataUrl;
    pickBtn.textContent = dataUrl ? 'Pakeisti nuotrauką' : 'Pasirinkti nuotrauką';
  };

  pickBtn.addEventListener('click', () => input.click());
  removeBtn.addEventListener('click', () => {
    setError('');
    show(null);
  });

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    setError('');

    if (!file.type.startsWith('image/')) {
      setError('Pasirink paveikslėlio failą (JPG, PNG ar WEBP).');
      show(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Nuotrauka per didelė — pasirink iki 10 MB.');
      show(null);
      return;
    }

    try {
      show(await resizeToSquare(file, 256));
    } catch {
      setError('Nepavyko nuskaityti nuotraukos. Pabandyk kitą failą.');
      show(null);
    }
  });

  return {
    get value() {
      return value;
    },
    set(dataUrl) {
      setError('');
      show(dataUrl);
    },
  };
}

function showBanner(el, message) {
  el.textContent = message || '';
  el.classList.toggle('is-visible', Boolean(message));
}

function setBusy(button, busy, busyLabel) {
  if (busy) button.dataset.label = button.textContent;
  button.textContent = busy ? busyLabel : button.dataset.label;
  button.disabled = busy;
}

// The "enter the code we emailed you" step (#verify-panel). Used after signing
// up, and when logging in to an account whose email was never confirmed.
// onVerified(session) runs once the code is accepted; finishingLabel shows on
// the button meanwhile.
function createVerifyStep({ onVerified, onChangeEmail, finishingLabel }) {
  const panel = document.getElementById('verify-panel');
  const verifyForm = document.getElementById('verify-form');
  const codeInput = verifyForm.elements.code;
  const verifyBtn = document.getElementById('verify-submit');
  const resendBtn = document.getElementById('verify-resend');
  const verifyError = document.getElementById('verify-error');
  let email = null;
  let cooldownTimer = null;

  const setCodeError = (message) => {
    codeInput.closest('.field').classList.toggle('has-error', Boolean(message));
    document.getElementById('verify-code-error').textContent = message;
    codeInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  };

  function startCooldown() {
    window.clearInterval(cooldownTimer);
    let remaining = RESEND_COOLDOWN_SECONDS;
    resendBtn.disabled = true;
    resendBtn.textContent = `Siųsti kodą dar kartą (${remaining} s)`;
    cooldownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(cooldownTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Siųsti kodą dar kartą';
      } else {
        resendBtn.textContent = `Siųsti kodą dar kartą (${remaining} s)`;
      }
    }, 1000);
  }

  resendBtn.addEventListener('click', async () => {
    showBanner(verifyError, '');
    resendBtn.disabled = true;
    const result = await resendEmailCode(email);
    if (result.ok) {
      startCooldown();
    } else {
      showBanner(verifyError, result.formError);
      resendBtn.disabled = false;
    }
  });

  document.getElementById('verify-change-email').addEventListener('click', () => {
    window.clearInterval(cooldownTimer);
    panel.hidden = true;
    onChangeEmail();
  });

  codeInput.addEventListener('input', () => {
    setCodeError('');
    showBanner(verifyError, '');
  });

  verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = codeInput.value.replace(/\s+/g, '');
    if (!CODE_PATTERN.test(code)) {
      setCodeError('Įvesk kodą iš laiško (tik skaičiai).');
      codeInput.focus();
      return;
    }
    setCodeError('');
    showBanner(verifyError, '');

    setBusy(verifyBtn, true, 'Tikrinama…');
    const result = await verifyEmailCode(email, code);
    setBusy(verifyBtn, false);

    if (!result.ok) {
      if (result.errors) {
        setCodeError(result.errors.code);
        codeInput.focus();
      } else {
        showBanner(verifyError, result.formError);
      }
      return;
    }
    window.clearInterval(cooldownTimer);
    saveSession(result.session);
    setBusy(verifyBtn, true, finishingLabel);
    await onVerified(result.session);
  });

  return {
    show(address) {
      email = address;
      document.getElementById('verify-email').textContent = address;
      panel.hidden = false;
      codeInput.value = '';
      setCodeError('');
      showBanner(verifyError, '');
      document.getElementById('verify-title').focus();
      startCooldown();
    },
    hide() {
      window.clearInterval(cooldownTimer);
      panel.hidden = true;
    },
  };
}

function initRegistrationForm() {
  const form = document.getElementById('register-form');
  if (!form) return;

  const successPanel = document.getElementById('register-success');
  const submitBtn = document.getElementById('register-submit');
  const formError = document.getElementById('form-error');
  const codePanel = document.getElementById('register-code');
  const codeForm = document.getElementById('code-form');
  const codeBtn = document.getElementById('code-submit');
  const codeFormError = document.getElementById('code-form-error');
  const touched = new Set();
  let accessCode = null;
  let pending = null;

  // --- Step 0: school access code ---
  const codeInput = codeForm.elements.accessCode;
  const setAccessCodeError = (message) => {
    codeInput.closest('.field').classList.toggle('has-error', Boolean(message));
    document.getElementById('access-code-error').textContent = message;
    codeInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  };

  const showCodeStep = (message) => {
    form.hidden = true;
    codePanel.hidden = false;
    setAccessCodeError(message || '');
    codeInput.focus();
  };

  codeInput.addEventListener('input', () => {
    setAccessCodeError('');
    showBanner(codeFormError, '');
  });

  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showBanner(codeFormError, '');
    const code = normalizeAccessCode(codeInput.value);
    if (!ACCESS_CODE_PATTERN.test(code)) {
      setAccessCodeError(ACCESS_CODE_MESSAGES.format);
      codeInput.focus();
      return;
    }
    setAccessCodeError('');

    setBusy(codeBtn, true, 'Tikrinama…');
    const result = await checkAccessCode(code);
    setBusy(codeBtn, false);

    if (!result.ok) {
      showBanner(codeFormError, result.formError);
      return;
    }
    if (result.status !== 'valid') {
      setAccessCodeError(ACCESS_CODE_MESSAGES[result.status] || ACCESS_CODE_MESSAGES.invalid);
      codeInput.focus();
      return;
    }

    accessCode = code;
    codeInput.value = formatAccessCode(code);
    codePanel.hidden = true;
    form.hidden = false;
    form.elements.fullName.focus();
  });

  const validators = {
    fullName: (v) => {
      const value = normalizeName(v);
      return NAME_PATTERN.test(value) && value.length <= 80 ? '' : FULL_NAME_RULE_MSG;
    },
    username: (v) => (USERNAME_PATTERN.test(v.trim()) ? '' : USERNAME_RULE_MSG),
    email: (v) => (EMAIL_PATTERN.test(v.trim()) ? '' : 'Įvesk teisingą el. pašto adresą.'),
    password: (v) => (isValidPassword(v) ? '' : PASSWORD_RULE_MSG),
    confirmPassword: (v) => (v === form.elements.password.value ? '' : 'Slaptažodžiai nesutampa.'),
    grade: (v) => (v ? '' : 'Pasirink savo klasę.'),
    bio: (v) => (v.trim().length <= BIO_MAX_LENGTH ? '' : BIO_TOO_LONG_MSG),
  };

  const setError = (name, message) => {
    const control = form.elements[name];
    const field = control.closest('.field');
    field.classList.toggle('has-error', Boolean(message));
    field.querySelector('.field-error').textContent = message;
    control.setAttribute('aria-invalid', message ? 'true' : 'false');
  };

  const validate = (name) => {
    const message = validators[name](form.elements[name].value);
    setError(name, message);
    return message;
  };

  Object.keys(validators).forEach((name) => {
    const control = form.elements[name];
    control.addEventListener('blur', () => {
      if (control.value === '' && !touched.has(name)) return;
      touched.add(name);
      validate(name);
    });
    const revalidate = () => {
      showBanner(formError, '');
      if (touched.has(name)) validate(name);
      if (name === 'password' && touched.has('confirmPassword')) validate('confirmPassword');
    };
    control.addEventListener('input', revalidate);
    control.addEventListener('change', () => {
      touched.add(name);
      revalidate();
    });
  });

  // Tell the student a username is taken as soon as they leave the field.
  form.elements.username.addEventListener('blur', async () => {
    const value = form.elements.username.value.trim();
    if (!value || validators.username(value)) return;
    const available = await checkUsernameAvailable(value);
    if (available === false && form.elements.username.value.trim() === value) {
      setError('username', USERNAME_TAKEN_MSG);
    }
  });

  const avatarPicker = createAvatarPicker();

  // --- Step 1: details -> sign up -> code is emailed ---
  const showSuccess = (user) => {
    const title = document.getElementById('success-title');
    document.getElementById('success-avatar').src = user.avatar;
    title.textContent = `Paskyra sukurta, ${user.fullName.split(/\s+/)[0]}!`;
    document.getElementById('success-text').textContent = `Tavo el. paštas patvirtintas. Vartotojo vardas: @${user.username}`;
    form.hidden = true;
    verifyStep.hide();
    successPanel.hidden = false;
    title.focus();
    initAccountHeader();
  };

  // The profile row is created by the database when the email gets confirmed,
  // so the optional picture can only be attached now.
  const finishRegistration = async (session) => {
    let avatar = DEFAULT_AVATAR;
    if (pending.avatar && session && (await saveAvatar(session, pending.avatar))) avatar = pending.avatar;
    showSuccess({ fullName: pending.fullName, username: pending.username, avatar });
  };

  // --- Step 2: enter the emailed code ---
  const verifyStep = createVerifyStep({
    finishingLabel: 'Kuriama…',
    onVerified: finishRegistration,
    onChangeEmail: () => {
      form.hidden = false;
      form.elements.email.focus();
    },
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showBanner(formError, '');

    let firstInvalid = null;
    Object.keys(validators).forEach((name) => {
      touched.add(name);
      if (validate(name) && !firstInvalid) firstInvalid = form.elements[name];
    });
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setBusy(submitBtn, true, 'Kuriama…');
    const values = {
      fullName: normalizeName(form.elements.fullName.value),
      username: form.elements.username.value.trim(),
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
      grade: form.elements.grade.value,
      bio: form.elements.bio.value.trim(),
      accessCode,
    };

    const available = await checkUsernameAvailable(values.username);
    const result = available === true
      ? await signUpUser(values)
      : available === false
        ? { ok: false, errors: { username: USERNAME_TAKEN_MSG } }
        : { ok: false, formError: backendConfig().supabaseUrl ? SAVE_FAILED_MSG : UNAVAILABLE_MSG };
    setBusy(submitBtn, false);

    if (!result.ok) {
      if (result.accessCodeError) {
        showCodeStep(result.accessCodeError);
      } else if (result.errors) {
        Object.entries(result.errors).forEach(([name, message]) => setError(name, message));
        form.elements[Object.keys(result.errors)[0]].focus();
      } else {
        showBanner(formError, result.formError);
      }
      return;
    }

    pending = { email: values.email, fullName: values.fullName, username: values.username, avatar: avatarPicker.value };
    if (result.session) {
      saveSession(result.session);
      finishRegistration(result.session);
    } else {
      form.hidden = true;
      verifyStep.show(values.email);
    }
  });
}

function initLoginForm() {
  const form = document.getElementById('login-form');
  if (!form) return;

  const submitBtn = document.getElementById('login-submit');
  const formError = document.getElementById('form-error');

  // Pages that need a login send students here with ?next=<page>; only a
  // plain page name from this site is accepted.
  const next = new URLSearchParams(window.location.search).get('next');
  const goHome = () => {
    window.location.href = next && /^[a-z0-9-]+\.html$/.test(next) ? next : 'index.html';
  };

  const setError = (name, message) => {
    const control = form.elements[name];
    control.closest('.field').classList.toggle('has-error', Boolean(message));
    document.getElementById(`${control.id}-error`).textContent = message;
    control.setAttribute('aria-invalid', message ? 'true' : 'false');
  };

  const verifyStep = createVerifyStep({
    finishingLabel: 'Jungiamasi…',
    onVerified: goHome,
    onChangeEmail: () => {
      form.hidden = false;
      form.elements.username.focus();
    },
  });

  ['username', 'password'].forEach((name) => {
    form.elements[name].addEventListener('input', () => {
      setError(name, '');
      showBanner(formError, '');
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showBanner(formError, '');

    const login = form.elements.username.value.trim().replace(/^@/, '');
    const password = form.elements.password.value;
    const loginError = login ? '' : 'Įvesk savo vartotojo vardą.';
    const passwordError = password ? '' : 'Įvesk slaptažodį.';
    setError('username', loginError);
    setError('password', passwordError);
    if (loginError || passwordError) {
      form.elements[loginError ? 'username' : 'password'].focus();
      return;
    }

    setBusy(submitBtn, true, 'Jungiamasi…');
    const result = await signInUser(login, password);

    if (result.ok) {
      saveSession(result.session);
      goHome();
      return;
    }
    setBusy(submitBtn, false);

    // Signed up but never typed in the emailed code: send a fresh one and
    // finish confirming here. (A failed resend, e.g. one sent less than a
    // minute ago, still leaves the earlier code usable.)
    if (result.unconfirmed) {
      await resendEmailCode(result.email);
      form.hidden = true;
      verifyStep.show(result.email);
      return;
    }
    showBanner(formError, result.formError);
    if (result.formError === LOGIN_FAILED_MSG) form.elements.password.select();
  });
}

const GRADE_LABELS = {
  5: '5 klasė',
  6: '6 klasė',
  7: '7 klasė',
  8: '8 klasė',
  9: '9 klasė (I gimnazijos)',
  10: '10 klasė (II gimnazijos)',
  11: '11 klasė (III gimnazijos)',
  12: '12 klasė (IV gimnazijos)',
};

// The school row, null when the account has none, undefined when it couldn't be loaded.
async function fetchMySchool(session) {
  const res = await callApi('/rest/v1/rpc/my_school', { body: {}, token: session.access_token });
  if (res.ok && Array.isArray(res.data)) return res.data[0] || null;
  console.error('Could not load school', res.status, res.data);
  return undefined;
}

// paskyra.html: the logged-in student's details and the log-out button.
function initAccountPage() {
  const page = document.getElementById('account');
  if (!page) return;

  if (!readSession()) {
    window.location.replace('prisijungti.html');
    return;
  }

  const view = document.getElementById('profile-view');
  const editForm = document.getElementById('profile-form');
  const editBtn = document.getElementById('edit-profile');
  const saveBtn = document.getElementById('profile-save');
  const editError = document.getElementById('profile-form-error');
  let current = null;

  const setText = (id, text) => {
    document.getElementById(id).textContent = text || '—';
  };

  const showProfile = (profile) => {
    if (!profile) return;
    current = profile;
    document.getElementById('account-avatar').src = profile.avatar || DEFAULT_AVATAR;
    document.getElementById('account-name').textContent = profile.full_name;
    setText('account-username', profile.username && `@${profile.username}`);
    setText('account-email', profile.email);
    setText('account-grade', GRADE_LABELS[profile.grade]);
    const bio = document.getElementById('account-bio');
    bio.textContent = profile.bio || '';
    bio.hidden = !profile.bio;
    editBtn.disabled = !profile.username;
  };

  showProfile(readCachedProfile());

  // --- Editing picture, username and description (pen button) ---
  const avatarPicker = createAvatarPicker();

  const setFieldError = (name, message) => {
    const control = editForm.elements[name];
    control.closest('.field').classList.toggle('has-error', Boolean(message));
    document.getElementById(`${control.id}-error`).textContent = message;
    control.setAttribute('aria-invalid', message ? 'true' : 'false');
  };

  const openEditor = () => {
    avatarPicker.set(current.avatar && current.avatar !== DEFAULT_AVATAR ? current.avatar : null);
    editForm.elements.fullName.value = current.full_name || '';
    editForm.elements.username.value = current.username || '';
    editForm.elements.bio.value = current.bio || '';
    ['fullName', 'username', 'bio'].forEach((name) => setFieldError(name, ''));
    showBanner(editError, '');
    view.hidden = true;
    editForm.hidden = false;
    document.getElementById('edit-title').focus();
  };

  const closeEditor = () => {
    editForm.hidden = true;
    view.hidden = false;
    editBtn.focus();
  };

  editBtn.addEventListener('click', openEditor);
  document.getElementById('profile-cancel').addEventListener('click', closeEditor);
  ['fullName', 'username', 'bio'].forEach((name) => {
    editForm.elements[name].addEventListener('input', () => {
      setFieldError(name, '');
      showBanner(editError, '');
    });
  });

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showBanner(editError, '');

    const fullName = normalizeName(editForm.elements.fullName.value);
    const username = editForm.elements.username.value.trim().replace(/^@/, '');
    const bio = editForm.elements.bio.value.trim();
    // A name is only checked when it was changed, so names set by Mokify
    // (e.g. a one-word test account) can still save other edits.
    const errors = {
      fullName: fullName === current.full_name || (NAME_PATTERN.test(fullName) && fullName.length <= 80)
        ? '' : FULL_NAME_RULE_MSG,
      username: USERNAME_PATTERN.test(username) ? '' : USERNAME_RULE_MSG,
      bio: bio.length <= BIO_MAX_LENGTH ? '' : BIO_TOO_LONG_MSG,
    };
    Object.entries(errors).forEach(([name, message]) => setFieldError(name, message));
    const firstInvalid = Object.keys(errors).find((name) => errors[name]);
    if (firstInvalid) {
      editForm.elements[firstInvalid].focus();
      return;
    }

    const changes = {};
    const avatar = avatarPicker.value || DEFAULT_AVATAR;
    if (avatar !== current.avatar) changes.avatar = avatar;
    if (fullName !== current.full_name) changes.full_name = fullName;
    if (username !== current.username) changes.username = username;
    if (bio !== (current.bio || '')) changes.bio = bio;
    if (!Object.keys(changes).length) {
      closeEditor();
      return;
    }

    setBusy(saveBtn, true, 'Saugoma…');
    const session = await getSession();
    const result = session
      ? await updateProfile(session, changes)
      : { ok: false, formError: NETWORK_FAILED_MSG };
    setBusy(saveBtn, false);

    if (!result.ok) {
      if (result.errors) {
        Object.entries(result.errors).forEach(([name, message]) => setFieldError(name, message));
        editForm.elements[Object.keys(result.errors)[0]].focus();
      } else {
        showBanner(editError, result.formError);
      }
      return;
    }

    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(result.profile));
    } catch {
      // Storage full or blocked: the header just fetches it again next time.
    }
    const headerImg = document.querySelector('.nav-account img');
    if (headerImg) headerImg.src = result.profile.avatar || DEFAULT_AVATAR;
    showProfile(result.profile);
    closeEditor();
  });

  const logoutBtn = document.getElementById('logout-button');
  logoutBtn.addEventListener('click', async () => {
    setBusy(logoutBtn, true, 'Atsijungiama…');
    await signOut();
    window.location.href = 'index.html';
  });

  getSession().then(async (session) => {
    if (!session) {
      if (!readSession()) window.location.replace('prisijungti.html');
      else showBanner(document.getElementById('account-error'), NETWORK_FAILED_MSG);
      return;
    }
    const [profile, school, teacher] = await Promise.all([
      fetchOwnProfile(session),
      fetchMySchool(session),
      fetchTeacher(session),
    ]);
    if (!profile) {
      showBanner(document.getElementById('account-error'), 'Nepavyko įkelti paskyros duomenų. Pabandyk dar kartą vėliau.');
      document.getElementById('account-teacher-status').textContent = 'Nepavyko įkelti';
      return;
    }
    showProfile(profile);
    initTeacherCard(teacher, school);
    setText('account-school', school === undefined ? 'Nepavyko įkelti' : school && school.name);
    if (school && !school.active) {
      showBanner(
        document.getElementById('account-warning'),
        'Tavo mokyklos Mokify prenumerata pasibaigė, todėl mokymosi funkcijos šiuo metu neprieinamos. Tavo paskyra išlieka — kai mokykla pratęs prenumeratą, galėsi vėl naudotis Mokify.',
      );
    }
  });
}

// paskyra.html: whether the student is a registered teacher, what they teach,
// and deactivating the teacher account. teacher is fetchTeacher's answer.
function initTeacherCard(teacher, school) {
  const card = document.getElementById('teacher-card');
  const statusEl = document.getElementById('account-teacher-status');
  if (teacher === undefined) {
    statusEl.textContent = 'Nepavyko įkelti';
    return;
  }

  const show = (current) => {
    const isTeacher = Boolean(current.profile);
    const active = isTeacher && !(school && !school.active);
    statusEl.textContent = !isTeacher
      ? 'Neužregistruota'
      : active ? 'Aktyvi' : 'Sustabdyta, nes mokyklos prenumerata pasibaigė';
    statusEl.classList.toggle('is-active', active);
    document.getElementById('account-teacher-mark').hidden = !isTeacher;
    document.getElementById('teacher-none').hidden = isTeacher;
    document.getElementById('teacher-active').hidden = !isTeacher;
    document.getElementById('teacher-edit').hidden = !isTeacher;
    if (!isTeacher) return;

    document.getElementById('teacher-subjects').textContent = formatSubjects(current.profile.subjects);
    document.getElementById('teacher-levels').textContent = formatLevels(current.profile.levels);

    const diplomas = current.documents.filter((d) => d.kind === 'diploma');
    const list = document.getElementById('teacher-diplomas');
    list.replaceChildren(...diplomas.map((doc) => {
      const li = document.createElement('li');
      const status = document.createElement('span');
      status.textContent = ` · ${DOCUMENT_STATUS_LABELS[doc.status] || doc.status}`;
      li.append(doc.title, status);
      return li;
    }));
    if (!diplomas.length) list.textContent = 'Neįkelta';

    const grades = current.documents.find((d) => d.kind === 'grades');
    document.getElementById('teacher-grades').textContent = grades
      ? `Įkelti · ${DOCUMENT_STATUS_LABELS[grades.status] || grades.status}`
      : 'Neįkelti';
  };

  show(teacher);

  // --- Deactivating, after a warning ---
  const dialog = document.getElementById('deactivate-dialog');
  const confirmBtn = document.getElementById('deactivate-confirm');
  const dialogError = document.getElementById('deactivate-error');

  document.getElementById('teacher-deactivate').addEventListener('click', () => {
    showBanner(dialogError, '');
    dialog.showModal();
  });

  confirmBtn.addEventListener('click', async () => {
    showBanner(dialogError, '');
    setBusy(confirmBtn, true, 'Deaktyvuojama…');
    const session = await getSession();
    const result = session ? await deactivateTeacher(session, teacher.documents) : { ok: false, formError: NETWORK_FAILED_MSG };
    setBusy(confirmBtn, false);
    if (!result.ok) {
      showBanner(dialogError, result.formError);
      return;
    }
    dialog.close();
    teacher = { profile: null, documents: [] };
    show(teacher);
    card.querySelector('#teacher-none .btn').focus();
  });
}

// Deletes the teacher profile (its documents go with it in the database),
// then their files. The student account is untouched.
async function deactivateTeacher(session, documents) {
  const res = await callApi(`/rest/v1/teacher_profiles?id=eq.${encodeURIComponent(session.user.id)}`, {
    method: 'DELETE',
    token: session.access_token,
    prefer: 'return=minimal',
  });
  if (!res.ok) {
    if (res.status === 0 || res.status === 429 || res.unconfigured) return failureFrom(res);
    console.error('Teacher deactivation failed', res.status, res.data);
    return { ok: false, formError: 'Nepavyko deaktyvuoti mokytojo paskyros. Pabandyk dar kartą.' };
  }
  if (documents.length) {
    // A file left behind here is never shown anywhere; nothing else to undo.
    await callApi(`/storage/v1/object/${TEACHER_BUCKET}`, {
      method: 'DELETE',
      token: session.access_token,
      body: { prefixes: documents.map((d) => d.storage_path) },
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Teacher registration (tapti-mokytoju.html)
// ---------------------------------------------------------------------------

// Same keys as the check on public.teacher_profiles.subjects.
const TEACHER_SUBJECTS = [
  ['matematika', 'Matematika'],
  ['lietuviu', 'Lietuvių kalba'],
  ['anglu', 'Anglų kalba'],
  ['vokieciu', 'Vokiečių kalba'],
  ['prancuzu', 'Prancūzų kalba'],
  ['rusu', 'Rusų kalba'],
  ['fizika', 'Fizika'],
  ['chemija', 'Chemija'],
  ['biologija', 'Biologija'],
  ['istorija', 'Istorija'],
  ['geografija', 'Geografija'],
  ['informatika', 'Informatika'],
  ['ekonomika', 'Ekonomika'],
];
const SUBJECT_LABELS = Object.fromEntries(TEACHER_SUBJECTS);

// Same keys as the check on public.teacher_profiles.levels.
const TEACHER_LEVELS = [
  ['5-8', '5–8 klasės'],
  ['9-10', '9–10 klasės (I–II gimnazijos)'],
  ['11-12', '11–12 klasės (III–IV gimnazijos)'],
];
const LEVEL_LABELS = Object.fromEntries(TEACHER_LEVELS);

const formatSubjects = (keys) => keys.map((key) => SUBJECT_LABELS[key] || key).join(', ');
const formatLevels = (keys) => keys.map((key) => LEVEL_LABELS[key] || key).join(', ');

// Same limits as the teacher-documents bucket in supabase/updates/2026-10-10-teachers.sql.
const TEACHER_BUCKET = 'teacher-documents';
const TEACHER_FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const TEACHER_FILE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIPLOMAS = 10;

const DOCUMENT_STATUS_LABELS = {
  pending: 'Laukia patikrinimo',
  verified: 'Patvirtinta',
  rejected: 'Nepatvirtinta',
};

const TEACHER_SAVE_FAILED_MSG = 'Nepavyko išsaugoti. Pabandyk dar kartą.';
const TEACHER_INACTIVE_MSG = 'Tavo mokyklos Mokify prenumerata pasibaigė, todėl tapti mokytoju ar keisti mokytojo profilio šiuo metu negalima.';

const randomId = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

// { profile, documents }, with profile null for students who don't teach yet.
// undefined when it couldn't be loaded.
async function fetchTeacher(session) {
  const id = encodeURIComponent(session.user.id);
  const [profileRes, docsRes] = await Promise.all([
    callApi(`/rest/v1/teacher_profiles?id=eq.${id}&select=subjects,levels`, { method: 'GET', token: session.access_token }),
    callApi(
      `/rest/v1/teacher_documents?teacher_id=eq.${id}&select=id,kind,title,storage_path,status&order=created_at`,
      { method: 'GET', token: session.access_token },
    ),
  ]);
  if (!profileRes.ok || !Array.isArray(profileRes.data) || !docsRes.ok || !Array.isArray(docsRes.data)) {
    console.error('Could not load teacher profile', profileRes.status, profileRes.data, docsRes.status, docsRes.data);
    return undefined;
  }
  return { profile: profileRes.data[0] || null, documents: docsRes.data };
}

// The database refuses teacher changes from students whose school
// subscription ended (row-level security answers 403).
function teacherFailureFrom(res) {
  if (res.status === 403) return { ok: false, formError: TEACHER_INACTIVE_MSG };
  if (res.status === 0 || res.status === 429 || res.unconfigured) return failureFrom(res);
  console.error('Teacher update failed', res.status, res.data);
  return { ok: false, formError: TEACHER_SAVE_FAILED_MSG };
}

// Subjects and the classes they will teach.
async function saveTeacherChoices(session, { subjects, levels }, isNew) {
  const res = isNew
    ? await callApi('/rest/v1/teacher_profiles', {
      token: session.access_token,
      prefer: 'return=minimal',
      body: { id: session.user.id, subjects, levels },
    })
    : await callApi(`/rest/v1/teacher_profiles?id=eq.${encodeURIComponent(session.user.id)}`, {
      method: 'PATCH',
      token: session.access_token,
      prefer: 'return=minimal',
      body: { subjects, levels },
    });
  return res.ok ? { ok: true } : teacherFailureFrom(res);
}

// Uploads the file into the student's own folder, then records it. Resolves
// to the new document row, or a failure.
async function addTeacherDocument(session, { kind, title, file }) {
  const { supabaseUrl, supabaseKey } = backendConfig();
  const path = `${session.user.id}/${randomId()}.${TEACHER_FILE_TYPES[file.type]}`;
  let uploaded;
  try {
    uploaded = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${TEACHER_BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': file.type },
      body: file,
    });
  } catch {
    return failureFrom({ status: 0, data: {} });
  }
  if (!uploaded.ok) {
    return teacherFailureFrom({ status: uploaded.status, data: await uploaded.json().catch(() => ({})) });
  }

  const res = await callApi('/rest/v1/teacher_documents', {
    token: session.access_token,
    prefer: 'return=representation',
    body: { teacher_id: session.user.id, kind, title, storage_path: path },
  });
  if (res.ok && Array.isArray(res.data) && res.data[0]) return { ok: true, document: res.data[0] };
  // Don't leave a file behind that no document points to.
  await callApi(`/storage/v1/object/${TEACHER_BUCKET}/${path}`, { method: 'DELETE', token: session.access_token });
  return teacherFailureFrom(res);
}

async function removeTeacherDocument(session, doc) {
  const res = await callApi(`/rest/v1/teacher_documents?id=eq.${encodeURIComponent(doc.id)}`, {
    method: 'DELETE',
    token: session.access_token,
    prefer: 'return=minimal',
  });
  if (!res.ok) return teacherFailureFrom(res);
  await callApi(`/storage/v1/object/${TEACHER_BUCKET}/${doc.storage_path}`, { method: 'DELETE', token: session.access_token });
  return { ok: true };
}

// tapti-mokytoju.html: the second registration, for students who also want
// to teach. Only reachable when logged in; the same form edits the subjects
// and documents later.
function initTeacherForm() {
  const form = document.getElementById('teacher-form');
  if (!form) return;

  if (!readSession()) {
    window.location.replace('prisijungti.html?next=tapti-mokytoju.html');
    return;
  }

  const submitBtn = document.getElementById('teacher-submit');
  const formError = document.getElementById('teacher-form-error');
  const subjectGrid = document.getElementById('subject-grid');
  const diplomaList = document.getElementById('diploma-list');
  const gradesList = document.getElementById('grades-list');
  const diplomaInput = document.getElementById('diploma-input');
  const gradesInput = document.getElementById('grades-input');
  const gradesPick = document.getElementById('grades-pick');

  let isNew = true;
  let saved = []; // Documents already stored, minus those marked for removal.
  const removed = []; // Stored documents to delete on save.
  let queued = []; // { kind, title, file } to upload on save.

  const setSectionError = (name, message) => {
    document.getElementById(`${name}-field`).classList.toggle('has-error', Boolean(message));
    document.getElementById(`${name}-error`).textContent = message;
  };

  // Checkbox groups: subjects and the classes they will teach.
  const addCheckboxes = (grid, name, options) => {
    options.forEach(([key, label]) => {
      const option = document.createElement('label');
      option.className = 'subject-option';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.name = name;
      box.value = key;
      option.append(box, label);
      grid.appendChild(option);
    });
    grid.addEventListener('change', () => {
      setSectionError(name, '');
      showBanner(formError, '');
    });
  };
  addCheckboxes(subjectGrid, 'subjects', TEACHER_SUBJECTS);
  addCheckboxes(document.getElementById('level-grid'), 'levels', TEACHER_LEVELS);

  const boxes = (name) => Array.from(form.elements[name]);
  const checkedValues = (name) => boxes(name).filter((b) => b.checked).map((b) => b.value);

  // --- Document lists ---
  const removeButton = (onRemove) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-button';
    btn.textContent = 'Pašalinti';
    btn.addEventListener('click', () => {
      onRemove();
      renderDocuments();
    });
    return btn;
  };

  const savedItem = (doc) => {
    const li = document.createElement('li');
    li.className = 'doc-item';
    const main = document.createElement('div');
    main.className = 'doc-item-main';
    const name = document.createElement('p');
    name.className = 'doc-item-name';
    name.textContent = doc.title;
    const status = document.createElement('p');
    status.className = `doc-item-status is-${doc.status}`;
    status.textContent = DOCUMENT_STATUS_LABELS[doc.status] || doc.status;
    main.append(name, status);
    li.append(main, removeButton(() => {
      saved = saved.filter((d) => d !== doc);
      removed.push(doc);
    }));
    return li;
  };

  const queuedItem = (item) => {
    const li = document.createElement('li');
    li.className = 'doc-item';
    const main = document.createElement('div');
    main.className = 'doc-item-main';
    if (item.kind === 'diploma') {
      const title = document.createElement('input');
      title.className = 'field-control';
      title.type = 'text';
      title.maxLength = 120;
      title.value = item.title;
      title.setAttribute('aria-label', `Diplomo pavadinimas (${item.file.name})`);
      title.addEventListener('input', () => {
        item.title = title.value;
        title.removeAttribute('aria-invalid');
        setSectionError('diplomas', '');
      });
      main.append(title);
    } else {
      const name = document.createElement('p');
      name.className = 'doc-item-name';
      name.textContent = item.file.name;
      main.append(name);
    }
    li.append(main, removeButton(() => {
      queued = queued.filter((q) => q !== item);
    }));
    return li;
  };

  function renderDocuments() {
    diplomaList.replaceChildren(
      ...saved.filter((d) => d.kind === 'diploma').map(savedItem),
      ...queued.filter((q) => q.kind === 'diploma').map(queuedItem),
    );
    gradesList.replaceChildren(
      ...saved.filter((d) => d.kind === 'grades').map(savedItem),
      ...queued.filter((q) => q.kind === 'grades').map(queuedItem),
    );
    gradesPick.textContent = gradesList.children.length ? 'Pakeisti TAMO pažymius' : 'Įkelti TAMO pažymius';
  }

  const fileProblem = (file) => {
    if (!TEACHER_FILE_TYPES[file.type]) return 'Įkelk PDF arba paveikslėlį (JPG, PNG ar WEBP).';
    if (file.size > TEACHER_FILE_MAX_BYTES) return 'Failas per didelis — įkelk iki 10 MB.';
    return '';
  };

  document.getElementById('diploma-pick').addEventListener('click', () => diplomaInput.click());
  gradesPick.addEventListener('click', () => gradesInput.click());

  diplomaInput.addEventListener('change', () => {
    const files = Array.from(diplomaInput.files);
    diplomaInput.value = '';
    setSectionError('diplomas', '');
    const count = saved.concat(queued).filter((d) => d.kind === 'diploma').length;
    if (count + files.length > MAX_DIPLOMAS) {
      setSectionError('diplomas', `Galima pridėti iki ${MAX_DIPLOMAS} diplomų.`);
      return;
    }
    const problem = files.map(fileProblem).find(Boolean);
    if (problem) {
      setSectionError('diplomas', problem);
      return;
    }
    files.forEach((file) => {
      queued.push({ kind: 'diploma', title: file.name.replace(/\.[^.]+$/, '').slice(0, 120), file });
    });
    renderDocuments();
  });

  // Only one grades file: a new one replaces the stored or chosen one.
  gradesInput.addEventListener('change', () => {
    const file = gradesInput.files[0];
    gradesInput.value = '';
    if (!file) return;
    const problem = fileProblem(file);
    setSectionError('grades', problem);
    if (problem) return;
    removed.push(...saved.filter((d) => d.kind === 'grades'));
    saved = saved.filter((d) => d.kind !== 'grades');
    queued = queued.filter((q) => q.kind !== 'grades');
    queued.push({ kind: 'grades', title: 'TAMO pažymiai', file });
    renderDocuments();
  });

  // --- Saving ---
  const showSuccess = ({ subjects, levels }) => {
    const title = document.getElementById('teacher-success-title');
    title.textContent = isNew ? 'Dabar esi ir mokytojas!' : 'Pakeitimai išsaugoti';
    const pending = saved.some((d) => d.status === 'pending');
    document.getElementById('teacher-success-text').textContent = `Mokysi: ${formatSubjects(subjects)} (${formatLevels(levels)}).${
      pending ? ' Kol diplomų ir pažymių nepatikrinsime, juos matai tik tu.' : ''}`;
    form.hidden = true;
    document.getElementById('teacher-success').hidden = false;
    title.focus();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showBanner(formError, '');

    const choices = { subjects: checkedValues('subjects'), levels: checkedValues('levels') };
    setSectionError('subjects', choices.subjects.length ? '' : 'Pasirink bent vieną dalyką.');
    setSectionError('levels', choices.levels.length ? '' : 'Pasirink bent vieną klasių grupę.');
    const firstEmpty = ['subjects', 'levels'].find((name) => !choices[name].length);
    if (firstEmpty) {
      boxes(firstEmpty)[0].focus();
      return;
    }
    const untitled = queued.find((q) => q.kind === 'diploma' && !q.title.trim());
    if (untitled) {
      setSectionError('diplomas', 'Įrašyk kiekvieno diplomo pavadinimą.');
      const empty = Array.from(diplomaList.querySelectorAll('input')).filter((input) => !input.value.trim());
      empty.forEach((input) => input.setAttribute('aria-invalid', 'true'));
      empty[0]?.focus();
      return;
    }

    setBusy(submitBtn, true, 'Saugoma…');
    const session = await getSession();
    let result = session ? await saveTeacherChoices(session, choices, isNew) : { ok: false, formError: NETWORK_FAILED_MSG };
    if (result.ok) isNew = false;

    // Removals first, so a replaced grades file is gone before the new one is added.
    while (result.ok && removed.length) {
      result = await removeTeacherDocument(session, removed[0]);
      if (result.ok) removed.shift();
    }
    while (result.ok && queued.length) {
      const item = queued[0];
      result = await addTeacherDocument(session, { kind: item.kind, title: item.title.trim(), file: item.file });
      if (result.ok) {
        queued.shift();
        saved.push(result.document);
      }
    }
    setBusy(submitBtn, false);

    if (!result.ok) {
      // Whatever got saved stays saved; the rest is still listed to try again.
      renderDocuments();
      submitBtn.textContent = 'Išsaugoti';
      showBanner(formError, result.formError);
      return;
    }
    showSuccess(choices);
  });

  // --- Loading what is already saved ---
  getSession().then(async (session) => {
    if (!session) {
      if (!readSession()) window.location.replace('prisijungti.html?next=tapti-mokytoju.html');
      else showBanner(formError, NETWORK_FAILED_MSG);
      return;
    }
    const [teacher, school] = await Promise.all([fetchTeacher(session), fetchMySchool(session)]);
    if (teacher === undefined) {
      showBanner(formError, 'Nepavyko įkelti duomenų. Pabandyk dar kartą vėliau.');
      return;
    }
    if (school && !school.active) {
      showBanner(document.getElementById('teacher-warning'), TEACHER_INACTIVE_MSG);
    }

    if (teacher.profile) {
      isNew = false;
      document.getElementById('teacher-title').textContent = 'Mokytojo profilis';
      submitBtn.textContent = 'Išsaugoti';
      ['subjects', 'levels'].forEach((name) => {
        boxes(name).forEach((box) => {
          box.checked = teacher.profile[name].includes(box.value);
        });
      });
    }
    saved = teacher.documents;
    renderDocuments();
    submitBtn.disabled = Boolean(school && !school.active);
  });
}
