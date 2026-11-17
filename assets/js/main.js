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
  initTeacherFinder();
  initChat();
  initReviewPage();
  initCodesPage();
  initNotifications();
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

  // Students' own pages, first in the menu once logged in.
  const memberPages = [['mokytojai.html', 'Mokytojai'], ['susitikimai.html', 'Susitikimai'], ['zinutes.html', 'Žinutės', 'messages']];
  // The address may or may not end in ".html", depending on the web host.
  const currentPage = window.location.pathname.replace(/\/$/, '').replace(/\.html$/, '');
  const finderLinks = ['.nav-links', '.mobile-menu'].flatMap((selector) => {
    const menu = document.querySelector(selector);
    if (!menu) return [];
    const links = memberPages.map(([href, label, key]) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      if (key) a.dataset.nav = key;
      if (currentPage.endsWith(`/${href.replace(/\.html$/, '')}`)) a.setAttribute('aria-current', 'page');
      return a;
    });
    menu.prepend(...links);
    return links;
  });

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
        finderLinks.forEach((a) => a.remove());
        root.classList.remove('signed-in');
        memberLinks.forEach((a) => a.setAttribute('href', a.dataset.guestHref));
      }
      return;
    }
    // The messages page keeps the count up to date itself.
    if (!document.getElementById('chat')) fetchUnreadCount(session).then(setNavUnread);
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
  // plain page name from this site is accepted (a meeting's code may come
  // along, so a meeting link still opens that meeting after logging in).
  const next = new URLSearchParams(window.location.search).get('next');
  const goHome = () => {
    window.location.href = next && /^[a-z0-9-]+\.html(\?k=[A-Za-z0-9-]{1,40})?$/.test(next) ? next : 'index.html';
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
    initReviewerLink(session);
    initAdminLink(session);
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
      status.textContent = ` · ${documentStatusText(doc)}`;
      li.append(doc.title, status);
      return li;
    }));
    if (!diplomas.length) list.textContent = 'Neįkelta';

    const grades = current.documents.find((d) => d.kind === 'grades');
    document.getElementById('teacher-grades').textContent = grades
      ? `Įkelti · ${documentStatusText(grades)}`
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

// "Nepatvirtinta: <the reviewer's note>", or just the status.
const documentStatusText = (doc) => {
  const label = DOCUMENT_STATUS_LABELS[doc.status] || doc.status;
  return doc.status !== 'pending' && doc.review_note ? `${label}: ${doc.review_note}` : label;
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
  const docsUrl = (columns) => `/rest/v1/teacher_documents?teacher_id=eq.${id}&select=${columns}&order=created_at`;
  const [profileRes, firstDocsRes] = await Promise.all([
    callApi(`/rest/v1/teacher_profiles?id=eq.${id}&select=subjects,levels`, { method: 'GET', token: session.access_token }),
    callApi(docsUrl('id,kind,title,storage_path,status,review_note'), { method: 'GET', token: session.access_token }),
  ]);
  // Before 2026-11-18-document-review.sql has run there is no review_note.
  const docsRes = firstDocsRes.status === 400
    ? await callApi(docsUrl('id,kind,title,storage_path,status'), { method: 'GET', token: session.access_token })
    : firstDocsRes;
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
    status.textContent = documentStatusText(doc);
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

// ---------------------------------------------------------------------------
// Finding a teacher (mokytojai.html)
// ---------------------------------------------------------------------------

// Students from every school who teach. Resolves to the list, or a failure
// ({ ok: false, formError }).
async function fetchTeachers(session) {
  const res = await callApi('/rest/v1/rpc/find_teachers', { body: {}, token: session.access_token });
  if (res.ok && Array.isArray(res.data)) return { ok: true, teachers: res.data };
  if (res.status === 0 || res.status === 429 || res.unconfigured) return failureFrom(res);
  console.error('Could not load teachers', res.status, res.data);
  return { ok: false, formError: 'Nepavyko įkelti mokytojų. Pabandyk dar kartą vėliau.' };
}

// Schools for the school filter ({ id, name, mine }). null when they
// couldn't be loaded.
async function fetchSchools(session) {
  const res = await callApi('/rest/v1/rpc/list_schools', { body: {}, token: session.access_token });
  if (res.ok && Array.isArray(res.data)) return res.data;
  console.error('Could not load schools', res.status, res.data);
  return null;
}

// Lowercase without diacritics, so "siauliu" finds "Šiaulių".
const searchKey = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Which TEACHER_LEVELS group a class belongs to.
const levelForGrade = (grade) => (grade <= 8 ? '5-8' : grade <= 10 ? '9-10' : '11-12');

// Lithuanian noun forms: 1 mokytojas, 2 mokytojai, 10 mokytojų, 21 mokytojas.
function pluralLt(n, one, few, many) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 19) return many;
  if (n % 10 === 1) return one;
  if (n % 10 === 0) return many;
  return few;
}

const FINDER_SUBJECT_KEY = 'mokify.finder.subject';
const FINDER_SCHOOLS_KEY = 'mokify.finder.schools';

function initTeacherFinder() {
  const page = document.getElementById('finder');
  if (!page) return;

  if (!readSession()) {
    window.location.replace('prisijungti.html?next=mokytojai.html');
    return;
  }

  const subjectGrid = document.getElementById('finder-subjects');
  const levelToggle = document.getElementById('finder-level-toggle');
  const myLevelBox = document.getElementById('finder-my-level');
  const countEl = document.getElementById('finder-count');
  const list = document.getElementById('teacher-list');
  const empty = document.getElementById('finder-empty');
  const emptyText = document.getElementById('finder-empty-text');
  const emptyAction = document.getElementById('finder-empty-action');
  const warning = document.getElementById('finder-warning');

  let teachers = null;
  let myLevel = null;
  let subject = '';
  try {
    const stored = localStorage.getItem(FINDER_SUBJECT_KEY);
    if (stored && SUBJECT_LABELS[stored]) subject = stored;
  } catch {
    // Storage blocked: start with every subject.
  }

  [['', 'Visi dalykai'], ...TEACHER_SUBJECTS].forEach(([key, label]) => {
    const option = document.createElement('label');
    option.className = 'subject-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'subject';
    radio.value = key;
    radio.checked = key === subject;
    option.append(radio, label);
    subjectGrid.appendChild(option);
  });

  const setSubject = (key) => {
    subject = key;
    subjectGrid.querySelector(`input[value="${key}"]`).checked = true;
    try {
      if (key) localStorage.setItem(FINDER_SUBJECT_KEY, key);
      else localStorage.removeItem(FINDER_SUBJECT_KEY);
    } catch {
      // Storage blocked: the choice is just not remembered.
    }
    render();
  };

  subjectGrid.addEventListener('change', (e) => setSubject(e.target.value));
  myLevelBox.addEventListener('change', () => render());

  // --- School filter: a button that opens a searchable list of checkboxes ---
  const schoolFilter = document.getElementById('school-filter');
  const schoolToggle = document.getElementById('school-filter-toggle');
  const schoolLabel = document.getElementById('school-filter-label');
  const schoolPanel = document.getElementById('school-filter-panel');
  const schoolSearch = document.getElementById('school-search');
  const schoolOptions = document.getElementById('school-options');
  const schoolNone = document.getElementById('school-none');
  const schoolClear = document.getElementById('school-clear');
  let selectedSchools = new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(FINDER_SCHOOLS_KEY));
    if (Array.isArray(stored)) selectedSchools = new Set(stored.filter((id) => typeof id === 'string'));
  } catch {
    // Storage blocked or empty: no schools chosen.
  }

  const saveSchools = () => {
    try {
      if (selectedSchools.size) localStorage.setItem(FINDER_SCHOOLS_KEY, JSON.stringify([...selectedSchools]));
      else localStorage.removeItem(FINDER_SCHOOLS_KEY);
    } catch {
      // Storage blocked: the choice is just not remembered.
    }
  };

  const updateSchoolLabel = () => {
    const n = selectedSchools.size;
    schoolLabel.textContent = n ? `Filtruoti pagal mokyklas (${n})` : 'Filtruoti pagal mokyklas';
    schoolClear.hidden = !n;
  };

  const filterSchoolOptions = () => {
    const query = searchKey(schoolSearch.value.trim());
    let visible = 0;
    schoolOptions.querySelectorAll('li').forEach((li) => {
      const show = !query || li.dataset.search.includes(query);
      li.hidden = !show;
      if (show) visible += 1;
    });
    schoolNone.hidden = visible > 0;
  };

  const setupSchools = (schools) => {
    // Forget chosen schools that are no longer listed.
    const known = new Set(schools.map((s) => s.id));
    selectedSchools = new Set([...selectedSchools].filter((id) => known.has(id)));
    saveSchools();

    // The student's own school first, the rest alphabetically.
    const sorted = [...schools].sort((a, b) => (b.mine - a.mine) || a.name.localeCompare(b.name, 'lt'));
    schoolOptions.replaceChildren(...sorted.map((s) => {
      const li = document.createElement('li');
      li.dataset.search = searchKey(s.name);
      const option = document.createElement('label');
      option.className = 'school-option';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = s.id;
      box.checked = selectedSchools.has(s.id);
      const name = document.createElement('span');
      name.textContent = s.name;
      option.append(box, name);
      if (s.mine) {
        const mine = document.createElement('span');
        mine.className = 'school-option-mine';
        mine.textContent = 'tavo mokykla';
        option.appendChild(mine);
      }
      li.appendChild(option);
      return li;
    }));
    updateSchoolLabel();
    schoolFilter.hidden = false;
  };

  const setPanelOpen = (open) => {
    schoolPanel.hidden = !open;
    schoolToggle.setAttribute('aria-expanded', String(open));
    if (open) schoolSearch.focus();
  };

  schoolToggle.addEventListener('click', () => setPanelOpen(schoolPanel.hidden));
  schoolSearch.addEventListener('input', filterSchoolOptions);
  // Enter in the search box would otherwise submit the filter form.
  document.getElementById('finder-filters').addEventListener('submit', (e) => e.preventDefault());
  schoolSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (schoolSearch.value) {
        schoolSearch.value = '';
        filterSchoolOptions();
      } else {
        setPanelOpen(false);
        schoolToggle.focus();
      }
    }
  });
  schoolOptions.addEventListener('change', (e) => {
    if (e.target.checked) selectedSchools.add(e.target.value);
    else selectedSchools.delete(e.target.value);
    saveSchools();
    updateSchoolLabel();
    render();
  });

  const clearSchools = () => {
    selectedSchools.clear();
    schoolOptions.querySelectorAll('input').forEach((box) => { box.checked = false; });
    saveSchools();
    updateSchoolLabel();
    render();
  };
  schoolClear.addEventListener('click', () => {
    clearSchools();
    schoolSearch.focus();
  });

  const matches = (t, { levelOnly = true, schoolsOnly = true, subjectOnly = true } = {}) => {
    const levelOn = levelOnly && Boolean(myLevel) && myLevelBox.checked;
    return (!subjectOnly || !subject || t.subjects.includes(subject))
      && (!levelOn || t.levels.includes(myLevel))
      && (!schoolsOnly || !selectedSchools.size || selectedSchools.has(t.school_id));
  };

  const detail = (term, value) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  };

  const teacherCard = (t) => {
    const li = document.createElement('li');
    li.className = 'teacher-card';

    const head = document.createElement('div');
    head.className = 'teacher-card-head';
    const frame = document.createElement('div');
    frame.className = 'avatar-frame';
    const img = document.createElement('img');
    img.src = t.avatar || DEFAULT_AVATAR;
    img.alt = '';
    img.width = 64;
    img.height = 64;
    img.loading = 'lazy';
    frame.appendChild(img);
    const title = document.createElement('div');
    title.className = 'teacher-card-title';
    const name = document.createElement('h3');
    name.textContent = t.full_name;
    const meta = document.createElement('p');
    meta.className = 'text-muted';
    meta.textContent = [t.username && `@${t.username}`, t.grade && `${t.grade} klasė`].filter(Boolean).join(' · ');
    title.append(name, meta);
    head.append(frame, title);
    li.appendChild(head);

    if (t.bio) {
      const bio = document.createElement('p');
      bio.className = 'teacher-card-bio';
      bio.textContent = t.bio;
      li.appendChild(bio);
    }

    const details = document.createElement('dl');
    details.className = 'teacher-card-details';
    // The chosen subject first, so it's what the eye lands on.
    const subjects = [...t.subjects].sort((a, b) => (b === subject) - (a === subject));
    details.append(
      detail(t.subjects.length === 1 ? 'Dalykas' : 'Dalykai', formatSubjects(subjects)),
      detail('Moko', t.levels.map((key) => LEVEL_LABELS[key].replace(/ \(.*\)$/, '')).join(', ')),
      detail('Mokykla', t.school_name),
    );
    if (t.verified_documents > 0) {
      const n = t.verified_documents;
      const row = detail('Dokumentai', `${n} ${pluralLt(n, 'patvirtintas', 'patvirtinti', 'patvirtintų')}`);
      row.querySelector('dd').classList.add('is-verified');
      details.appendChild(row);
    }
    li.appendChild(details);

    const write = document.createElement('a');
    write.className = 'btn btn-primary btn-sm';
    write.href = `zinutes.html?su=${encodeURIComponent(t.id)}`;
    write.textContent = 'Parašyti žinutę';
    li.appendChild(write);
    return li;
  };

  const showEmpty = (text, action) => {
    emptyText.textContent = text;
    emptyAction.hidden = !action;
    if (action) {
      emptyAction.textContent = action.label;
      emptyAction.onclick = action.run;
    }
    empty.hidden = false;
  };

  function render() {
    if (!teachers) return;
    const shown = teachers.filter((t) => matches(t));

    const word = pluralLt(shown.length, 'mokytojas', 'mokytojai', 'mokytojų');
    countEl.textContent = subject
      ? `${SUBJECT_LABELS[subject]}: ${shown.length} ${word}`
      : `${shown.length} ${word}`;
    list.replaceChildren(...shown.map(teacherCard));
    empty.hidden = true;
    if (shown.length) return;

    if (!teachers.length) {
      showEmpty('Kol kas niekas neužsiregistravo mokytoju.');
      return;
    }

    // Offer to loosen the one filter that would bring teachers back.
    const levelOn = Boolean(myLevel) && myLevelBox.checked;
    const any = (opts) => teachers.some((t) => matches(t, opts));
    if (levelOn && any({ levelOnly: false })) {
      showEmpty('Pagal pasirinktus filtrus mokytojų tavo klasei nerasta.', {
        label: 'Rodyti visų klasių mokytojus',
        run: () => { myLevelBox.checked = false; render(); },
      });
    } else if (selectedSchools.size && any({ schoolsOnly: false })) {
      showEmpty(
        subject ? 'Pasirinktose mokyklose šio dalyko mokytojų nėra.' : 'Pasirinktose mokyklose mokytojų nėra.',
        { label: 'Rodyti visų mokyklų mokytojus', run: clearSchools },
      );
    } else if (subject && any({ subjectOnly: false })) {
      showEmpty('Šio dalyko mokytojų kol kas nėra.', { label: 'Rodyti visus dalykus', run: () => setSubject('') });
    } else {
      showEmpty('Pagal pasirinktus filtrus mokytojų nerasta.', {
        label: 'Išvalyti filtrus',
        run: () => {
          myLevelBox.checked = false;
          subject = '';
          subjectGrid.querySelector('input[value=""]').checked = true;
          try { localStorage.removeItem(FINDER_SUBJECT_KEY); } catch { /* not remembered */ }
          clearSchools();
        },
      });
    }
  }

  const fail = (message) => {
    countEl.textContent = 'Nepavyko įkelti';
    showBanner(warning, message);
  };

  getSession().then(async (session) => {
    if (!session) {
      if (!readSession()) window.location.replace('prisijungti.html?next=mokytojai.html');
      else fail(NETWORK_FAILED_MSG);
      return;
    }
    const [profile, school, result, schools] = await Promise.all([
      fetchOwnProfile(session),
      fetchMySchool(session),
      fetchTeachers(session),
      fetchSchools(session),
    ]);

    if (school && !school.active) {
      countEl.hidden = true;
      document.getElementById('finder-filters').hidden = true;
      showBanner(
        warning,
        'Tavo mokyklos Mokify prenumerata pasibaigė, todėl mokytojų sąrašas šiuo metu neprieinamas. Kai mokykla pratęs prenumeratą, galėsi vėl ieškoti mokytojų.',
      );
      return;
    }
    if (!result.ok) {
      fail(result.formError);
      return;
    }

    if (profile && profile.grade) {
      myLevel = levelForGrade(profile.grade);
      levelToggle.hidden = false;
    }
    // Without the school list the page still works, just without that filter.
    if (schools) setupSchools(schools);
    else selectedSchools.clear();
    teachers = result.teachers;
    render();
  });
}
// ---------------------------------------------------------------------------
// Messages (zinutes.html)
// ---------------------------------------------------------------------------

// Same limit as the check on public.messages.body.
const MESSAGE_MAX_LENGTH = 2000;
const CHAT_POLL_MS = 5000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_CLOSED_MSG = 'Šiam moksleiviui rašyti nebegalima.';
const CHAT_BLOCKED_MSG = 'Tu užblokavai šį moksleivį.';
const CHAT_INACTIVE_MSG = 'Tavo mokyklos Mokify prenumerata pasibaigė, todėl rašyti žinučių šiuo metu negalima.';

// Everyone the student has exchanged messages with, newest first. null when
// it couldn't be loaded.
async function fetchConversations(session) {
  const res = await callApi('/rest/v1/rpc/my_conversations', { body: {}, token: session.access_token });
  if (res.ok && Array.isArray(res.data)) return res.data;
  console.error('Could not load conversations', res.status, res.data);
  return null;
}

// Name and picture of a schoolmate to start a conversation with. null when
// there is no such schoolmate, undefined when it couldn't be loaded.
async function fetchChatPartner(session, id) {
  const res = await callApi('/rest/v1/rpc/chat_partner', { body: { p_id: id }, token: session.access_token });
  if (res.ok && Array.isArray(res.data)) return res.data[0] || null;
  console.error('Could not load chat partner', res.status, res.data);
  return undefined;
}

// The newest 200 messages with partnerId (only those after `after` when
// given), oldest first. null when they couldn't be loaded.
async function fetchMessages(session, partnerId, after) {
  const me = session.user.id;
  const pair = `or=(and(sender_id.eq.${me},recipient_id.eq.${partnerId}),and(sender_id.eq.${partnerId},recipient_id.eq.${me}))`;
  const since = after ? `&created_at=gt.${encodeURIComponent(after)}` : '';
  const ask = () => callApi(
    `/rest/v1/messages?${pair}${since}&select=id,sender_id,body,created_at${fetchMessages.plain ? '' : ',lesson_id,lesson_event,lesson_at,deleted_at'}&order=created_at.desc&limit=200`,
    { method: 'GET', token: session.access_token },
  );
  let res = await ask();
  // A database that doesn't know lessons yet (the lessons update wasn't run):
  // the chat still works, just without them.
  if (!res.ok && res.status === 400 && !fetchMessages.plain) {
    fetchMessages.plain = true;
    res = await ask();
  }
  if (res.ok && Array.isArray(res.data)) return res.data.reverse();
  console.error('Could not load messages', res.status, res.data);
  return null;
}

async function sendMessage(session, recipientId, body) {
  const res = await callApi('/rest/v1/messages?select=id,sender_id,body,created_at', {
    token: session.access_token,
    prefer: 'return=representation',
    body: { recipient_id: recipientId, body },
  });
  if (res.ok && Array.isArray(res.data) && res.data[0]) return { ok: true, message: res.data[0] };
  if (res.status === 403) return { ok: false, closed: true };
  if (res.status === 0 || res.status === 429 || res.unconfigured) return failureFrom(res);
  console.error('Could not send message', res.status, res.data);
  return { ok: false, formError: 'Nepavyko išsiųsti žinutės. Pabandyk dar kartą.' };
}

const markConversationRead = (session, partnerId) => callApi('/rest/v1/rpc/mark_conversation_read', {
  body: { p_partner: partnerId },
  token: session.access_token,
});

async function fetchUnreadCount(session) {
  const res = await callApi('/rest/v1/rpc/unread_message_count', { body: {}, token: session.access_token });
  return res.ok && typeof res.data === 'number' ? res.data : 0;
}

// Blocking, unblocking and deleting a chat for yourself. Resolves to
// { ok: true } or a failure ({ ok: false, formError }).
async function chatAction(session, fn, body) {
  const res = await callApi(`/rest/v1/rpc/${fn}`, { body, token: session.access_token });
  if (res.ok) return { ok: true };
  if (res.status === 0 || res.status === 429 || res.unconfigured) return failureFrom(res);
  console.error(`${fn} failed`, res.status, res.data);
  return { ok: false, formError: 'Nepavyko. Pabandyk dar kartą.' };
}

const blockUser = (session, id) => chatAction(session, 'block_user', { p_id: id });
const unblockUser = (session, id) => chatAction(session, 'unblock_user', { p_id: id });
const hideConversation = (session, id) => chatAction(session, 'hide_conversation', { p_partner: id });

// Links to Mokify meetings (susitikimai.html?k=xxxx-xxxx-xxxx).
const MEETING_LINK_PATTERN = /https?:\/\/[^\s<>"']+\/susitikimai(?:\.html)?\?k=[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}(?![A-Za-z0-9-])/g;
const meetingPageLink = (code) => `susitikimai.html?k=${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;

// Puts a message's text into el. Everything stays plain text, except links
// to a meeting on this very site, which become clickable. Such a link is
// rebuilt from the meeting's code alone, so whatever else was typed around
// it can never end up in the address.
function fillMessageBody(el, text) {
  let done = 0;
  for (const match of text.matchAll(MEETING_LINK_PATTERN)) {
    let url;
    try {
      url = new URL(match[0]);
    } catch {
      continue;
    }
    if (url.origin !== window.location.origin) continue;
    const code = (url.searchParams.get('k') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (code.length !== 12) continue;
    el.append(text.slice(done, match.index));
    const a = document.createElement('a');
    a.href = meetingPageLink(code);
    // A meeting opens in a tab of its own; the chat stays where it is.
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = match[0];
    el.appendChild(a);
    done = match.index + match[0].length;
  }
  el.append(text.slice(done));
}

// ---------------------------------------------------------------------------
// Notifications on the website (top right corner), for signed-in students:
// new messages, lesson requests and lesson moments. Only inside the site;
// nothing is sent to the computer's or phone's own notifications.
//
// The database answers what happened since a given moment
// (public.my_notifications). This browser remembers that moment and what it
// has shown, so nothing shows twice. Coming back after a while away, the
// messages that arrived meanwhile are summed up in one notification
// ("Turi 3 naujas žinutes") instead of pouring in one by one; of the lesson
// moments only "the lesson ended because of being late" is still shown.
// ---------------------------------------------------------------------------

const NOTIFY_KEY = 'mokify.notify';
const NOTIFY_POLL_MS = 8000;
// Longer than this without checking (tab closed or hidden) counts as away.
const NOTIFY_AWAY_MS = 90 * 1000;
const NOTIFY_SHOW_MS = 6000;

// Set by the messages page: whose conversation is open, and whether it is
// scrolled to the newest message (then its messages need no notification).
let activeChat = null;

function readNotifyState() {
  try {
    const s = JSON.parse(localStorage.getItem(NOTIFY_KEY));
    if (s && typeof s === 'object' && Array.isArray(s.keys)) return s;
  } catch {
    // Nothing stored or storage blocked.
  }
  return null;
}

function saveNotifyState(s) {
  try {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify({ ...s, keys: s.keys.slice(-300) }));
  } catch {
    // Storage blocked: notifications may repeat after a reload.
  }
}

function initNotifications() {
  if (!readSession()) return;
  const userId = readSession().user.id;

  // The corner where notifications appear, one at a time.
  const box = document.createElement('div');
  box.className = 'site-toasts';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  document.body.appendChild(box);

  const queue = [];
  let showing = false;

  function showNext() {
    if (showing || !queue.length) return;
    showing = true;
    const n = queue.shift();
    const toast = document.createElement('div');
    toast.className = 'site-toast';
    const link = document.createElement('a');
    link.className = 'site-toast-body';
    link.href = n.href;
    if (n.newTab) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    const title = document.createElement('strong');
    title.textContent = n.title;
    link.appendChild(title);
    if (n.text) {
      const text = document.createElement('span');
      text.textContent = n.text;
      link.appendChild(text);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'site-toast-close';
    close.setAttribute('aria-label', 'Uždaryti pranešimą');
    close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    toast.append(link, close);
    box.appendChild(toast);

    let timer = null;
    let gone = false;
    const leave = () => {
      if (gone) return;
      gone = true;
      window.clearTimeout(timer);
      toast.classList.add('is-leaving');
      const done = () => {
        toast.remove();
        showing = false;
        window.setTimeout(showNext, 150);
      };
      toast.addEventListener('animationend', done, { once: true });
      // Without animations (reduced motion) animationend may not come.
      window.setTimeout(done.bind(null), 400);
    };
    const wait = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(leave, NOTIFY_SHOW_MS);
    };
    // Stays while pointed at or focused, so it can be read.
    toast.addEventListener('mouseenter', () => window.clearTimeout(timer));
    toast.addEventListener('mouseleave', wait);
    toast.addEventListener('focusin', () => window.clearTimeout(timer));
    toast.addEventListener('focusout', wait);
    close.addEventListener('click', leave);
    link.addEventListener('click', leave);
    wait();
  }

  const show = (n) => {
    queue.push(n);
    showNext();
  };

  const chatLink = (partner) => `zinutes.html?su=${encodeURIComponent(partner)}`;
  const lessonLink = (lesson) => `pamoka.html?k=${encodeURIComponent(lesson)}`;
  const here = () => window.MokifyHere || {};

  // What a received message says in a notification.
  function messageNote(m) {
    const note = { title: m.name, text: m.body, href: chatLink(m.from) };
    if (m.event === 'invite' && UUID_PATTERN.test(m.lesson || '')) {
      return { title: `${m.name} kviečia į pamoką`, text: 'Spausk, kad prisijungtum.', href: lessonLink(m.lesson), newTab: true };
    }
    if (m.event === 'propose') return { ...note, title: `${m.name} siūlo pamokos laiką`, text: m.body };
    if (m.event === 'reschedule') return { ...note, title: `${m.name} siūlo perkelti pamoką`, text: m.body };
    return note;
  }

  // What a lesson moment says.
  function eventNote(e) {
    const open = { href: lessonLink(e.lesson), newTab: true };
    switch (e.kind) {
      case 'open': return { ...open, title: 'Jau gali prisijungti prie pamokos', text: `Pamoka su ${e.name} prasideda po 10 minučių.` };
      case 'joined': return { ...open, title: `${e.name} prisijungė prie pamokos`, text: 'Spausk, kad prisijungtum ir tu.' };
      case 'late5': return { ...open, title: 'Vėluoji į pamoką 5 minutes', text: `${e.name} tavęs laukia.` };
      case 'late10': return { ...open, title: 'Vėluoji į pamoką 10 minučių', text: `${e.name} jau gali pamoką atšaukti.` };
      case 'late_ended': return { title: 'Pamoka baigta, nes vėlavai', text: `Pamoka su ${e.name} neįvyko.`, href: chatLink(e.partner) };
      case 'partner_late': return { title: `Pamoka baigta, nes ${e.name} vėlavo`, text: 'Daugiau nei 15 minučių.', href: chatLink(e.partner) };
      default: return null;
    }
  }

  // A diploma or the grades of the student's own were checked.
  function documentNote(d) {
    const grades = d.kind === 'grades';
    if (d.status === 'verified') {
      return grades
        ? { title: 'TAMO pažymiai patvirtinti', text: 'Jie dabar matomi tavo mokytojo profilyje.', href: 'paskyra.html' }
        : { title: 'Diplomas patvirtintas', text: `„${d.title}“ dabar matomas tavo mokytojo profilyje.`, href: 'paskyra.html' };
    }
    if (grades) return { title: 'TAMO pažymiai nepatvirtinti', text: d.note || 'Gali įkelti kitus.', href: 'tapti-mokytoju.html' };
    return { title: 'Diplomas nepatvirtintas', text: d.note ? `„${d.title}“: ${d.note}` : `„${d.title}“. Gali įkelti kitą.`, href: 'tapti-mokytoju.html' };
  }

  // For reviewers: documents uploaded meanwhile. On the review page itself
  // the list just refreshes.
  function reviewNote(n) {
    if (!(n > 0)) return null;
    if (typeof here().review === 'function') {
      here().review();
      return null;
    }
    return {
      title: `${n} ${pluralLt(n, 'naujas dokumentas laukia', 'nauji dokumentai laukia', 'naujų dokumentų laukia')} patikrinimo`,
      text: 'Spausk, kad peržiūrėtum.',
      href: 'tikrinimas.html',
    };
  }

  let busy = false;
  async function check() {
    if (busy || document.visibilityState !== 'visible') return;
    busy = true;
    try {
      const session = await getSession();
      if (!session || session.user.id !== userId) return;
      let state = readNotifyState();
      if (state && state.user !== userId) state = null;
      const away = !state || Date.now() - (state.checkedAt || 0) > NOTIFY_AWAY_MS;
      const res = await callApi('/rest/v1/rpc/my_notifications', {
        body: { p_since: state ? state.since : null },
        token: session.access_token,
      });
      const data = res.ok && res.data && res.data.ok ? res.data : null;
      if (!data) return;
      // Another tab may have shown some meanwhile.
      const latest = readNotifyState();
      const keys = new Set(latest && latest.user === userId ? latest.keys : (state ? state.keys : []));
      const messages = Array.isArray(data.messages) ? data.messages : [];
      const events = Array.isArray(data.events) ? data.events : [];
      const documents = (Array.isArray(data.documents) ? data.documents : [])
        .filter((d) => !keys.has(`d:${d.id}:${d.at}`));
      documents.forEach((d) => keys.add(`d:${d.id}:${d.at}`));
      const fresh = [];

      if (away) {
        // Back after a while: one line for the messages, and lessons that
        // ended because of being late.
        const n = data.unread_new || 0;
        const chat = activeChat && activeChat.partnerId();
        if (n > 0 && !(chat && n === messages.filter((m) => m.from === chat && !m.read).length && activeChat.atBottom())) {
          fresh.push({
            title: `Turi ${n} ${pluralLt(n, 'naują žinutę', 'naujas žinutes', 'naujų žinučių')}`,
            text: 'Spausk, kad perskaitytum.',
            href: 'zinutes.html',
          });
        }
        events.forEach((e) => {
          const key = `e:${e.kind}:${e.lesson}`;
          if (!keys.has(key) && (e.kind === 'late_ended' || e.kind === 'partner_late')) fresh.push(eventNote(e));
          keys.add(key);
        });
        messages.forEach((m) => keys.add(`m:${m.id}`));
        // Checked documents: one line for several.
        if (documents.length === 1) fresh.push(documentNote(documents[0]));
        if (documents.length > 1) {
          const ok = documents.filter((d) => d.status === 'verified').length;
          const parts = [ok && `patvirtinta ${ok}`, documents.length - ok && `nepatvirtinta ${documents.length - ok}`].filter(Boolean);
          fresh.push({ title: 'Patikrinome tavo dokumentus', text: `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()), href: 'paskyra.html' });
        }
        fresh.push(reviewNote(data.review_new));
      } else {
        messages.forEach((m) => {
          const key = `m:${m.id}`;
          if (keys.has(key)) return;
          keys.add(key);
          if (m.read || m.from === userId) return;
          // Already in view: the conversation is open and scrolled to the newest.
          if (activeChat && activeChat.partnerId() === m.from && activeChat.atBottom()) return;
          fresh.push(messageNote(m));
        });
        events.forEach((e) => {
          const key = `e:${e.kind}:${e.lesson}`;
          if (keys.has(key)) return;
          keys.add(key);
          // (The database only reports moments that still matter: "you can
          // join" only until the lesson is over, and so on.)
          // Already on that lesson's page.
          if ((e.kind === 'open' || e.kind === 'joined') && here().lesson === e.lesson) return;
          const note = eventNote(e);
          if (note) fresh.push(note);
        });
        documents.forEach((d) => fresh.push(documentNote(d)));
        fresh.push(reviewNote(data.review_new));
      }

      saveNotifyState({ user: userId, since: data.now, checkedAt: Date.now(), keys: [...keys] });
      fresh.filter(Boolean).forEach(show);
    } finally {
      busy = false;
    }
  }

  check();
  window.setInterval(check, NOTIFY_POLL_MS);
  document.addEventListener('visibilitychange', check);
}

// ---------------------------------------------------------------------------
// Document review (tikrinimas.html): Mokify's reviewers approve or reject the
// diplomas and TAMO grades teachers upload. Who is a reviewer, and every
// rule, lives in the database (supabase/updates/2026-11-18-document-review.sql);
// for anyone else this page gets nothing.
// ---------------------------------------------------------------------------

const DOCUMENT_KIND_LABELS = { diploma: 'Diplomas', grades: 'TAMO pažymiai' };
const DOCUMENT_FILE_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

// "2026 m. lapkričio 11 d., 14:05"
function formatReviewTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('lt-LT', { year: 'numeric', month: 'long', day: 'numeric' })}, ${
    d.toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' })}`;
}

// Downloads one uploaded file with the reviewer's login. The file's type is
// set from its name (the database only allows these four), never taken from
// the upload, so a file can only ever be shown as a picture or a PDF.
async function fetchDocumentFile(session, path) {
  const match = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.exec(path || '');
  if (!match) return null;
  const { supabaseUrl, supabaseKey } = backendConfig();
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/authenticated/${TEACHER_BUCKET}/${path}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return null;
    return new Blob([await res.arrayBuffer()], { type: DOCUMENT_FILE_TYPES[match[1]] });
  } catch {
    return null;
  }
}

async function reviewRpc(session, fn, params) {
  const res = await callApi(`/rest/v1/rpc/${fn}`, { body: params, token: session.access_token });
  if (res.ok && res.data && typeof res.data === 'object') return res.data;
  if (res.status === 0 || res.unconfigured) return { ok: false, error: 'network' };
  if (res.status === 404) return { ok: false, error: 'missing' };
  console.error(`${fn} failed`, res.status, res.data);
  return { ok: false, error: 'failed' };
}

const REVIEW_ERRORS = {
  network: NETWORK_FAILED_MSG,
  too_long: 'Pastaba gali būti iki 300 simbolių.',
  not_found: 'Šio dokumento nebėra — mokinys jį pašalino.',
  own: 'Savo dokumento patvirtinti negali.',
  failed: 'Nepavyko. Pabandyk dar kartą.',
};

function initReviewPage() {
  const page = document.getElementById('review');
  if (!page) return;
  if (!readSession()) {
    window.location.replace('prisijungti.html?next=tikrinimas.html');
    return;
  }

  const list = document.getElementById('review-list');
  const empty = document.getElementById('review-empty');
  const emptyText = document.getElementById('review-empty-text');
  const none = document.getElementById('review-none');
  const open = document.getElementById('review-open');
  const preview = document.getElementById('review-preview');
  const form = document.getElementById('review-form');
  const note = document.getElementById('review-note');
  const error = document.getElementById('review-error');
  const approveBtn = document.getElementById('review-approve');
  const rejectBtn = document.getElementById('review-reject');
  const tabs = [...page.querySelectorAll('.review-tab')];

  let status = 'pending';
  let items = [];
  let current = null;
  let fileUrl = null;
  let loadToken = 0;

  const deny = (text) => {
    page.hidden = true;
    const denied = document.getElementById('review-denied');
    if (text) document.getElementById('review-denied-text').textContent = text;
    denied.hidden = false;
  };

  const setCounts = (counts) => {
    ['pending', 'verified', 'rejected'].forEach((key) => {
      document.getElementById(`review-count-${key}`).textContent = counts && counts[key] ? `(${counts[key]})` : '';
    });
  };

  const showPreview = (child) => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = null;
    preview.replaceChildren(child);
  };

  function renderList() {
    list.replaceChildren(...items.map((item) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-item';
      btn.dataset.id = item.id;
      btn.setAttribute('aria-current', String(Boolean(current && current.id === item.id)));
      const text = document.createElement('span');
      text.className = 'chat-item-text';
      const top = document.createElement('span');
      top.className = 'chat-item-top';
      const name = document.createElement('span');
      name.className = 'chat-item-name';
      name.textContent = item.name;
      const time = document.createElement('time');
      const at = status === 'pending' ? item.uploaded_at : item.reviewed_at;
      time.dateTime = at;
      time.textContent = formatChatTime(at);
      top.append(name, time);
      const kind = document.createElement('span');
      kind.className = 'review-item-kind';
      kind.textContent = DOCUMENT_KIND_LABELS[item.kind] || item.kind;
      const snippet = document.createElement('span');
      snippet.className = 'chat-item-snippet';
      snippet.textContent = item.kind === 'grades' ? `@${item.username}` : item.title;
      text.append(top, kind, snippet);
      btn.appendChild(text);
      btn.addEventListener('click', () => select(item));
      li.appendChild(btn);
      return li;
    }));
    empty.hidden = items.length > 0;
    if (!items.length) {
      emptyText.textContent = {
        pending: 'Visi dokumentai patikrinti.',
        verified: 'Patvirtintų dokumentų dar nėra.',
        rejected: 'Nepatvirtintų dokumentų nėra.',
      }[status];
    }
  }

  async function select(item) {
    current = item;
    renderList();
    none.hidden = true;
    open.hidden = false;
    page.classList.add('is-thread-open');
    showBanner(error, '');

    document.getElementById('review-name').textContent = item.name;
    document.getElementById('review-meta').textContent = `@${item.username} · ${item.grade} klasė · ${item.school}`;
    document.getElementById('review-title').textContent = item.kind === 'grades'
      ? DOCUMENT_KIND_LABELS.grades
      : `${DOCUMENT_KIND_LABELS.diploma}: ${item.title}`;
    document.getElementById('review-uploaded').textContent = formatReviewTime(item.uploaded_at);
    document.getElementById('review-subjects').textContent = `${formatSubjects(item.subjects || [])} (${formatLevels(item.levels || [])})`;

    const decidedRow = document.getElementById('review-decided-row');
    decidedRow.hidden = item.status === 'pending';
    if (item.status !== 'pending') {
      const label = document.getElementById('review-decided-label');
      label.textContent = DOCUMENT_STATUS_LABELS[item.status];
      label.className = `review-status is-${item.status}`;
      document.getElementById('review-decided').textContent = item.note
        ? `${formatReviewTime(item.reviewed_at)}. Pastaba: ${item.note}`
        : formatReviewTime(item.reviewed_at);
    }

    document.getElementById('review-own').hidden = !item.own;
    form.hidden = item.own;
    note.value = item.note || '';
    // On a decided document, only the other decision is offered.
    approveBtn.hidden = item.status === 'verified';
    rejectBtn.hidden = item.status === 'rejected';

    // The file itself.
    const token = ++loadToken;
    const loading = document.createElement('p');
    loading.textContent = 'Kraunama…';
    showPreview(loading);
    const session = await getSession();
    const blob = session ? await fetchDocumentFile(session, item.path) : null;
    if (token !== loadToken) return;
    if (!blob) {
      const failed = document.createElement('p');
      failed.textContent = 'Nepavyko atidaryti failo.';
      showPreview(failed);
      return;
    }
    const url = URL.createObjectURL(blob);
    let el;
    if (blob.type === 'application/pdf') {
      el = document.createElement('iframe');
      el.title = `${DOCUMENT_KIND_LABELS[item.kind]}: ${item.title}`;
    } else {
      el = document.createElement('img');
      el.alt = `${DOCUMENT_KIND_LABELS[item.kind]}: ${item.title}`;
    }
    el.src = url;
    showPreview(el);
    fileUrl = url;
  }

  function closeDetail() {
    current = null;
    loadToken += 1;
    showPreview(document.createTextNode(''));
    open.hidden = true;
    none.hidden = false;
    page.classList.remove('is-thread-open');
    renderList();
  }

  async function load({ keep } = {}) {
    const session = await getSession();
    if (!session) {
      if (!readSession()) window.location.replace('prisijungti.html?next=tikrinimas.html');
      else emptyText.textContent = NETWORK_FAILED_MSG;
      return;
    }
    const asked = status;
    const data = await reviewRpc(session, 'review_queue', { p_status: asked });
    if (asked !== status) return;
    if (!data.ok) {
      if (data.error === 'forbidden') deny();
      else if (data.error === 'missing') deny('Dokumentų tikrinimas dar neįjungtas.');
      else emptyText.textContent = REVIEW_ERRORS[data.error] || REVIEW_ERRORS.failed;
      return;
    }
    setCounts(data.counts);
    items = Array.isArray(data.items) ? data.items : [];
    const still = keep && current && items.find((i) => i.id === current.id);
    if (still) {
      current = still;
      renderList();
    } else {
      closeDetail();
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.status === status) return;
      status = tab.dataset.status;
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      items = [];
      list.replaceChildren();
      empty.hidden = false;
      emptyText.textContent = 'Kraunama…';
      closeDetail();
      load();
    });
  });

  document.getElementById('review-back').addEventListener('click', closeDetail);

  async function decide(newStatus, btn) {
    if (!current) return;
    showBanner(error, '');
    const text = note.value.trim();
    if (text.length > 300) {
      showBanner(error, REVIEW_ERRORS.too_long);
      return;
    }
    setBusy(btn, true, 'Saugoma…');
    const session = await getSession();
    const result = session
      ? await reviewRpc(session, 'review_decide', { p_document: current.id, p_status: newStatus, p_note: text || null })
      : { ok: false, error: 'network' };
    setBusy(btn, false);
    if (!result.ok) {
      if (result.error === 'forbidden') {
        deny();
        return;
      }
      showBanner(error, REVIEW_ERRORS[result.error] || REVIEW_ERRORS.failed);
      if (result.error === 'not_found') load({ keep: false });
      return;
    }
    // Decided: it leaves this list; the next one waiting opens straight away.
    const index = items.findIndex((i) => i.id === current.id);
    items = items.filter((i) => i.id !== current.id);
    const next = status === 'pending' ? items[Math.min(index, items.length - 1)] : null;
    load({ keep: false }).then(() => {
      const again = next && items.find((i) => i.id === next.id);
      if (again && window.matchMedia('(min-width: 860px)').matches) select(again);
    });
  }

  approveBtn.addEventListener('click', () => decide('verified', approveBtn));
  rejectBtn.addEventListener('click', () => decide('rejected', rejectBtn));

  // New uploads, as the notifications learn of them, land in the list
  // instead of in a notification.
  window.MokifyHere = { ...(window.MokifyHere || {}), review: () => load({ keep: true }) };

  load();
}

// paskyra.html: reviewers get a way to the review page.
async function initReviewerLink(session) {
  const link = document.getElementById('review-link');
  if (!link) return;
  const res = await callApi('/rest/v1/rpc/is_reviewer', { body: {}, token: session.access_token });
  link.hidden = !(res.ok && res.data === true);
}

// ---------------------------------------------------------------------------
// Registration codes (kodai.html): Mokify's admins add schools and create the
// codes students sign up with. Who is an admin, and every rule, lives in the
// database (supabase/updates/2026-11-19-admin-codes.sql); for anyone else
// this page gets nothing.
// ---------------------------------------------------------------------------

const CODES_MAX = 1000;
const NEW_SCHOOL = 'new';

const CODES_ERRORS = {
  network: NETWORK_FAILED_MSG,
  bad_count: `Galima sukurti nuo 1 iki ${CODES_MAX} kodų iš karto.`,
  bad_name: 'Įvesk mokyklos pavadinimą (2–200 simbolių).',
  bad_email: 'Patikrink el. pašto adresą.',
  bad_date: 'Pasirink datą nuo šiandien iki penkerių metų į priekį.',
  exists: 'Mokykla tokiu pavadinimu jau yra. Pasirink ją sąraše.',
  expired: 'Šios mokyklos prenumerata baigėsi, todėl jos kodais užsiregistruoti nebūtų galima.',
  not_found: 'Šios mokyklos nebėra. Atnaujink puslapį.',
  failed: 'Nepavyko. Pabandyk dar kartą.',
};

// "YYYY-MM-DD" of a local date.
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function initCodesPage() {
  const page = document.getElementById('codes');
  if (!page) return;
  if (!readSession()) {
    window.location.replace('prisijungti.html?next=kodai.html');
    return;
  }

  const form = document.getElementById('codes-form');
  const select = document.getElementById('codes-school');
  const newBox = document.getElementById('codes-new');
  const nameInput = document.getElementById('school-name');
  const emailInput = document.getElementById('school-email');
  const endsInput = document.getElementById('school-ends');
  const countInput = document.getElementById('codes-count');
  const error = document.getElementById('codes-error');
  const submit = document.getElementById('codes-submit');
  const result = document.getElementById('codes-result');
  const resultTitle = document.getElementById('codes-result-title');
  const list = document.getElementById('codes-list');
  const copyBtn = document.getElementById('codes-copy');
  let schools = [];
  let today = isoDay(new Date());
  let made = null; // { school, codes }

  const deny = (text) => {
    page.hidden = true;
    if (text) document.getElementById('codes-denied-text').textContent = text;
    document.getElementById('codes-denied').hidden = false;
  };

  const setError = (input, message) => {
    const field = input.closest('.field');
    field.classList.toggle('has-error', Boolean(message));
    field.querySelector('.field-error').textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  };
  const clearErrors = () => {
    [select, nameInput, emailInput, endsInput, countInput].forEach((input) => setError(input, ''));
    showBanner(error, '');
  };

  // A new school's subscription: by default to the end of the coming
  // school year (31 August).
  const setDateLimits = () => {
    const [y, m, d] = today.split('-').map(Number);
    endsInput.min = today;
    endsInput.max = `${y + 5}-${String(m).padStart(2, '0')}-${String(Math.min(d, 28)).padStart(2, '0')}`;
    if (!endsInput.value) endsInput.value = `${m >= 9 ? y + 1 : y}-08-31`;
  };

  const showNewFields = () => {
    newBox.hidden = select.value !== NEW_SCHOOL;
  };

  function fillSchools(selectId) {
    const options = schools.map((s) => {
      const option = document.createElement('option');
      option.value = s.id;
      const expired = s.subscription_ends < today;
      // What exists already (not a limit on how many can be made).
      option.textContent = expired
        ? `${s.name} — prenumerata baigėsi`
        : `${s.name} — sukurta ${s.codes} ${pluralLt(s.codes, 'kodas', 'kodai', 'kodų')}, panaudota ${s.used}`;
      option.disabled = expired;
      return option;
    });
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.textContent = 'Pasirink mokyklą';
    const add = document.createElement('option');
    add.value = NEW_SCHOOL;
    add.textContent = 'Pridėti naują mokyklą…';
    select.replaceChildren(placeholder, ...options, add);
    const keep = selectId && schools.some((s) => s.id === selectId);
    select.value = keep ? selectId : (schools.length ? '' : NEW_SCHOOL);
    showNewFields();
  }

  async function loadSchools(selectId) {
    const session = await getSession();
    if (!session) {
      if (!readSession()) window.location.replace('prisijungti.html?next=kodai.html');
      else showBanner(error, NETWORK_FAILED_MSG);
      return;
    }
    const data = await reviewRpc(session, 'admin_schools', {});
    if (!data.ok) {
      if (data.error === 'forbidden') deny();
      else if (data.error === 'missing') deny('Kodų kūrimas dar neįjungtas.');
      else showBanner(error, CODES_ERRORS[data.error] || CODES_ERRORS.failed);
      return;
    }
    if (typeof data.today === 'string') today = data.today;
    schools = Array.isArray(data.schools) ? data.schools : [];
    setDateLimits();
    fillSchools(selectId);
    submit.disabled = false;
  }

  // Checks the form; returns false and marks the fields if something is off.
  function validate() {
    let ok = true;
    const count = Number(countInput.value);
    if (!Number.isInteger(count) || count < 1 || count > CODES_MAX) {
      setError(countInput, CODES_ERRORS.bad_count);
      ok = false;
    }
    if (!select.value) {
      setError(select, 'Pasirink mokyklą arba pridėk naują.');
      ok = false;
    }
    if (select.value === NEW_SCHOOL) {
      const name = nameInput.value.trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 200) {
        setError(nameInput, CODES_ERRORS.bad_name);
        ok = false;
      } else if (schools.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        setError(nameInput, CODES_ERRORS.exists);
        ok = false;
      }
      const email = emailInput.value.trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setError(emailInput, CODES_ERRORS.bad_email);
        ok = false;
      }
      if (!endsInput.value || endsInput.value < endsInput.min || endsInput.value > endsInput.max) {
        setError(endsInput, CODES_ERRORS.bad_date);
        ok = false;
      }
    }
    return ok;
  }

  const FIELD_OF_ERROR = { bad_name: nameInput, exists: nameInput, bad_email: emailInput, bad_date: endsInput, bad_count: countInput };
  const showError = (code) => {
    if (code === 'forbidden') {
      deny();
      return;
    }
    const input = FIELD_OF_ERROR[code];
    if (input) setError(input, CODES_ERRORS[code]);
    else showBanner(error, CODES_ERRORS[code] || CODES_ERRORS.failed);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    if (!validate()) return;
    setBusy(submit, true, 'Kuriama…');
    const session = await getSession();
    if (!session) {
      setBusy(submit, false);
      showError('network');
      return;
    }

    // A new school is saved first and then stays selected, so trying again
    // after a failure doesn't add it twice.
    let schoolId = select.value;
    if (schoolId === NEW_SCHOOL) {
      const created = await reviewRpc(session, 'admin_create_school', {
        p_name: nameInput.value,
        p_contact_email: emailInput.value.trim() || null,
        p_subscription_ends: endsInput.value,
      });
      if (!created.ok || !created.school) {
        setBusy(submit, false);
        showError(created.error);
        return;
      }
      schools = [...schools, created.school].sort((a, b) => a.name.localeCompare(b.name, 'lt'));
      schoolId = created.school.id;
      fillSchools(schoolId);
      nameInput.value = '';
      emailInput.value = '';
    }

    const count = Number(countInput.value);
    const data = await reviewRpc(session, 'admin_generate_codes', { p_school: schoolId, p_count: count });
    setBusy(submit, false);
    if (!data.ok || !Array.isArray(data.codes)) {
      showError(data.error);
      return;
    }
    made = { school: data.school, codes: data.codes };
    const n = data.codes.length;
    resultTitle.textContent = `Sukurta ${n} ${pluralLt(n, 'kodas', 'kodai', 'kodų')}: ${data.school}`;
    list.value = data.codes.join('\n');
    form.hidden = true;
    result.hidden = false;
    resultTitle.focus();
  });

  select.addEventListener('change', () => {
    setError(select, '');
    showNewFields();
    if (select.value === NEW_SCHOOL) nameInput.focus();
  });

  copyBtn.addEventListener('click', async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.codes.join('\n'));
      copyBtn.textContent = 'Nukopijuota';
      window.clearTimeout(copyBtn.resetTimer);
      copyBtn.resetTimer = window.setTimeout(() => {
        copyBtn.textContent = 'Kopijuoti';
      }, 2500);
    } catch {
      // No clipboard access: select them so they can be copied by hand.
      list.focus();
      list.select();
    }
  });

  // A spreadsheet file (opens in Excel or Google Sheets). The BOM tells Excel
  // it's UTF-8, so Lithuanian letters in the school name come out right.
  document.getElementById('codes-download').addEventListener('click', () => {
    if (!made) return;
    const school = `"${made.school.replace(/"/g, '""')}"`;
    const csv = `﻿Mokykla,Kodas\r\n${made.codes.map((c) => `${school},${c}`).join('\r\n')}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mokify-kodai-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById('codes-again').addEventListener('click', () => {
    const selected = select.value;
    made = null;
    list.value = '';
    result.hidden = true;
    form.hidden = false;
    loadSchools(selected);
    select.focus();
  });

  submit.disabled = true;
  loadSchools();
}

// paskyra.html: admins get a way to the codes page.
async function initAdminLink(session) {
  const link = document.getElementById('codes-link');
  if (!link) return;
  const res = await callApi('/rest/v1/rpc/is_admin', { body: {}, token: session.access_token });
  link.hidden = !(res.ok && res.data === true);
}

// --- Lessons: one-on-one video sessions, arranged in the chat --------------
// (supabase/updates/2026-11-14-lessons.sql; the call itself is pamoka.html)

const LESSON_ERRORS = {
  network: NETWORK_FAILED_MSG,
  limit: 'Per daug kvietimų. Pabandyk vėliau.',
  too_many: 'Jau yra penki neatsakyti pasiūlymai. Palauk atsakymo arba atšauk kurį nors.',
  already: 'Jūs jau turite suplanuotą pamoką arba neatsakytą pasiūlymą.',
  started: 'Pamoka jau prasidėjo, todėl jos nebegalima perkelti ar atšaukti.',
  bad_time: 'Pasirink laiką ne anksčiau kaip po 5 minučių ir ne vėliau kaip po metų.',
  closed: CHAT_CLOSED_MSG,
  no_teacher: 'Pamokas galima rengti tik su mokytoju.',
  inactive: 'Tavo mokyklos Mokify prenumerata pasibaigė, todėl pamokos šiuo metu neprieinamos.',
  disabled: 'Pamokos laikinai išjungtos. Pabandyk vėliau.',
  over: 'Šis laikas jau praėjo.',
  not_found: 'Šis pasiūlymas nebegalioja.',
  failed: 'Nepavyko. Pabandyk dar kartą.',
};

// Calls one of the lesson_* database functions. Resolves to its answer,
// { ok: true, ... } or { ok: false, error }.
async function lessonRpc(session, fn, body) {
  const res = await callApi(`/rest/v1/rpc/${fn}`, { body, token: session.access_token });
  if (res.ok && res.data && typeof res.data.ok === 'boolean') return res.data;
  if (res.status === 0 || res.unconfigured) return { ok: false, error: 'network' };
  if (res.status === 429) return { ok: false, error: 'limit' };
  console.error(`${fn} failed`, res.status, res.data);
  return { ok: false, error: 'failed' };
}

const lessonPageLink = (id) => `pamoka.html?k=${id}`;

// "penktadienis, lapkričio 14 d., 16:00"
function formatLessonTime(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('lt-LT', {
    weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
  return `${day}, ${d.toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' })}`;
}

// A date as <input type="date"> wants it, in the student's own time zone.
const dateInputValue = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The unread count beside "Žinutės" in the menu (hidden at 0).
function setNavUnread(count) {
  document.querySelectorAll('a[data-nav="messages"]').forEach((a) => {
    let badge = a.querySelector('.nav-count');
    if (!count) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-count';
      a.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.setAttribute('aria-label', `${count} ${pluralLt(count, 'neperskaityta', 'neperskaitytos', 'neperskaitytų')}`);
  });
}

const isSameDay = (a, b) => a.toDateString() === b.toDateString();

// Browsers write short Lithuanian dates as "11-09", so months are spelled out here.
const LT_MONTHS_SHORT = ['saus.', 'vas.', 'kov.', 'bal.', 'geg.', 'birž.', 'liep.', 'rugp.', 'rugs.', 'spal.', 'lapkr.', 'gruod.'];

// "14:05" for today, "lapkr. 9" this year, "2025-12-01" before that.
function formatChatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) return d.toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return `${LT_MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  return d.toLocaleDateString('lt-LT');
}

function formatChatDay(d) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, now)) return 'Šiandien';
  if (isSameDay(d, yesterday)) return 'Vakar';
  return d.toLocaleDateString('lt-LT', { year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric' });
}

function initChat() {
  const page = document.getElementById('chat');
  if (!page) return;

  if (!readSession()) {
    window.location.replace('prisijungti.html?next=zinutes.html');
    return;
  }

  const listEl = document.getElementById('chat-list');
  const listEmpty = document.getElementById('chat-list-empty');
  const listEmptyText = document.getElementById('chat-list-empty-text');
  const noneEl = document.getElementById('chat-none');
  const openEl = document.getElementById('chat-open');
  const messagesEl = document.getElementById('chat-messages');
  const composer = document.getElementById('chat-composer');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const closedEl = document.getElementById('chat-closed');
  const errorEl = document.getElementById('chat-error');

  let session = null;
  let schoolActive = true;
  let conversations = [];
  let current = null; // { id, full_name, username, avatar, can_message, blocked_by_me }
  let shownIds = new Set();
  let lastAt = null;
  let lastDay = null;

  const partnerFromConvo = (c) => ({
    id: c.partner_id,
    full_name: c.full_name,
    username: c.username,
    avatar: c.avatar,
    can_message: c.can_reply,
    blocked_by_me: Boolean(c.blocked_by_me),
  });

  const avatarFrame = (src, size) => {
    const frame = document.createElement('div');
    frame.className = 'avatar-frame';
    const img = document.createElement('img');
    img.src = src || DEFAULT_AVATAR;
    img.alt = '';
    img.width = size;
    img.height = size;
    frame.appendChild(img);
    return frame;
  };

  // --- Conversation list ---
  const renderList = () => {
    listEl.replaceChildren(...conversations.map((c) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-item';
      if (current && current.id === c.partner_id) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => openConversation(partnerFromConvo(c)));

      const text = document.createElement('div');
      text.className = 'chat-item-text';
      const top = document.createElement('div');
      top.className = 'chat-item-top';
      const name = document.createElement('span');
      name.className = 'chat-item-name';
      name.textContent = c.full_name;
      const time = document.createElement('time');
      time.dateTime = c.last_at;
      time.textContent = formatChatTime(c.last_at);
      top.append(name, time);
      const snippet = document.createElement('span');
      snippet.className = 'chat-item-snippet';
      snippet.textContent = (c.last_from_me ? 'Tu: ' : '') + c.last_body;
      text.append(top, snippet);

      btn.append(avatarFrame(c.avatar, 44), text);
      if (c.unread) {
        btn.classList.add('is-unread');
        const badge = document.createElement('span');
        badge.className = 'chat-unread';
        badge.textContent = c.unread > 99 ? '99+' : String(c.unread);
        badge.setAttribute('aria-label', `${c.unread} ${pluralLt(c.unread, 'neperskaityta', 'neperskaitytos', 'neperskaitytų')}`);
        btn.appendChild(badge);
      }
      li.appendChild(btn);
      return li;
    }));
    listEmpty.hidden = conversations.length > 0;
    setNavUnread(conversations.reduce((sum, c) => sum + (c.unread || 0), 0));
  };

  const showListEmpty = (text, withFindButton) => {
    listEmptyText.textContent = text;
    document.getElementById('chat-find').hidden = !withFindButton;
    listEmpty.hidden = false;
  };

  const refreshList = async () => {
    const fresh = await fetchConversations(session);
    if (!fresh) return false;
    conversations = fresh;
    renderList();
    if (!conversations.length) showListEmpty('Dar neturi pokalbių. Susirask mokytoją ir parašyk pirmąją žinutę.', true);
    return true;
  };

  // --- Messages ---
  const nearBottom = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  // Tells the notifications which conversation is in view.
  activeChat = {
    partnerId: () => (current && !openEl.hidden ? current.id : null),
    atBottom: () => document.visibilityState === 'visible' && nearBottom(),
  };

  const appendMessages = (messages, { forceScroll = false } = {}) => {
    const stick = forceScroll || nearBottom();
    messages.forEach((m) => {
      if (shownIds.has(m.id)) return;
      shownIds.add(m.id);
      const at = new Date(m.created_at);
      if (!lastDay || !isSameDay(at, lastDay)) {
        const day = document.createElement('li');
        day.className = 'chat-day';
        day.textContent = formatChatDay(at);
        messagesEl.appendChild(day);
      }
      lastDay = at;
      if (!lastAt || m.created_at > lastAt) lastAt = m.created_at;

      const li = document.createElement('li');
      li.className = `chat-message${m.sender_id === session.user.id ? ' is-mine' : ''}`;
      const body = document.createElement('p');
      const time = document.createElement('time');
      time.dateTime = m.created_at;
      time.textContent = at.toLocaleTimeString('lt-LT', { hour: '2-digit', minute: '2-digit' });
      if (m.lesson_id && UUID_PATTERN.test(m.lesson_id)) {
        // An invitation to a lesson, a proposed time, or asking to call a
        // lesson off: a card with buttons, kept up to date as things change.
        li.classList.add('chat-lesson');
        li.dataset.lesson = m.lesson_id;
        li.dataset.body = m.body;
        if (['invite', 'propose', 'cancel', 'reschedule'].includes(m.lesson_event)) li.dataset.event = m.lesson_event;
        if (m.lesson_at) li.dataset.at = m.lesson_at;
        const actions = document.createElement('div');
        actions.className = 'chat-lesson-actions';
        li.append(body, actions, time);
        renderLessonCard(li);
      } else {
        const foot = document.createElement('div');
        foot.className = 'chat-message-foot';
        foot.appendChild(time);
        li.append(body, foot);
        if (m.deleted_at) {
          showDeleted(li);
        } else {
          fillMessageBody(body, m.body);
          if (m.sender_id === session.user.id) addDeleteButton(li, m.id);
        }
      }
      messageEls.set(m.id, li);
      messagesEl.appendChild(li);
    });
    if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  // --- Deleting your own messages ---
  // Shown as "Žinutė ištrinta" for both. The other student's page learns
  // about it on its next check (deletedSince below).
  let messageEls = new Map(); // Shown messages by id.

  function showDeleted(li) {
    li.classList.add('is-deleted');
    li.querySelector('p').textContent = 'Žinutė ištrinta';
    li.querySelector('.chat-message-delete')?.remove();
  }

  function addDeleteButton(li, id) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-message-delete';
    btn.textContent = 'Ištrinti';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      askToConfirm({
        title: 'Ištrinti žinutę?',
        text: 'Žinutė dings jums abiem.',
        ok: 'Ištrinti',
        run: async () => {
          const res = await callApi('/rest/v1/rpc/delete_message', { body: { p_id: id }, token: session.access_token });
          if (res.ok && res.data && res.data.ok) {
            showDeleted(li);
            refreshList();
            return { ok: true };
          }
          if (res.ok && res.data && res.data.error === 'not_found') {
            showDeleted(li);
            return { ok: true };
          }
          if (res.status === 0 || res.unconfigured) return failureFrom(res);
          return { ok: false, formError: 'Nepavyko ištrinti žinutės. Pabandyk dar kartą.' };
        },
      });
    });
    li.querySelector('.chat-message-foot').prepend(btn);
    // On a touch screen there is no hovering: a tap on the message shows it.
    li.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;
      const wasSelected = li.classList.contains('is-selected');
      messagesEl.querySelectorAll('.chat-message.is-selected').forEach((el) => el.classList.remove('is-selected'));
      li.classList.toggle('is-selected', !wasSelected);
    });
  }

  // Messages of the open conversation deleted by the other student, since
  // it was opened. Marks them on screen.
  async function checkDeleted() {
    if (!current || !session || fetchMessages.plain || !messageEls.size) return;
    const partner = current;
    const me = session.user.id;
    const pair = `or=(and(sender_id.eq.${me},recipient_id.eq.${partner.id}),and(sender_id.eq.${partner.id},recipient_id.eq.${me}))`;
    const res = await callApi(
      `/rest/v1/messages?${pair}&deleted_at=not.is.null&select=id&order=created_at.desc&limit=200`,
      { method: 'GET', token: session.access_token },
    );
    if (current !== partner || !res.ok || !Array.isArray(res.data)) return;
    res.data.forEach(({ id }) => {
      const li = messageEls.get(id);
      if (li && !li.classList.contains('is-deleted') && !li.classList.contains('chat-lesson')) showDeleted(li);
    });
  }

  // --- Lessons with this student: invite now, or agree on a time ---
  const meetBtn = document.getElementById('chat-meet');
  const planBtn = document.getElementById('chat-plan');
  const nextBar = document.getElementById('chat-lesson-next');
  const lessonDialog = document.getElementById('lesson-dialog');
  const hasLessons = Boolean(meetBtn && planBtn && nextBar && lessonDialog);
  let lessons = new Map(); // The lessons with the open conversation's student, by id.

  const joinLink = (id) => {
    const a = document.createElement('a');
    a.className = 'btn btn-primary btn-sm';
    a.href = lessonPageLink(id);
    // The lesson opens in a tab of its own; the chat stays where it is.
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Prisijungti';
    return a;
  };
  const lessonButton = (label, className, run) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${className} btn-sm`;
    btn.textContent = label;
    btn.addEventListener('click', () => run(btn));
    return btn;
  };

  // Answers or calls off a lesson, then shows where things stand.
  async function lessonAction(btn, fn, body) {
    showBanner(errorEl, '');
    if (btn) btn.disabled = true;
    session = (await getSession()) || session;
    const result = await lessonRpc(session, fn, body);
    if (btn) btn.disabled = false;
    if (!result.ok) showBanner(errorEl, LESSON_ERRORS[result.error] || LESSON_ERRORS.failed);
    await refreshLessons();
    poll();
    return result;
  }

  // What a lesson's card in the conversation says and offers right now.
  function renderLessonCard(li) {
    const text = li.querySelector('p');
    const actions = li.querySelector('.chat-lesson-actions');
    const l = lessons.get(li.dataset.lesson);
    actions.replaceChildren();
    if (!l) {
      text.textContent = li.dataset.body;
      return;
    }
    const name = current ? current.full_name : '';
    const when = l.starts_at ? formatLessonTime(l.starts_at) : '';
    if (li.dataset.event === 'cancel') {
      // Asking to call a lesson off (from an earlier version of the site,
      // when that needed both to agree).
      text.textContent = l.state === 'cancelled' ? `Pamoka atšaukta: ${when}.` : 'Prašymas atšaukti pamoką nebegalioja.';
      return;
    }
    if (li.dataset.event === 'reschedule') {
      // A proposal to move an agreed lesson to another time.
      const to = li.dataset.at ? formatLessonTime(li.dataset.at) : '';
      const sameTime = (a, b) => a && b && Date.parse(a) === Date.parse(b);
      if (l.reschedule && sameTime(l.reschedule_to, li.dataset.at) && l.state === 'upcoming') {
        if (l.reschedule === 'me') text.textContent = `Pasiūlei perkelti pamoką į ${to}. Laukiama atsakymo.`;
        else {
          text.textContent = `${name} siūlo perkelti pamoką (${when}) į ${to}.`;
          actions.append(
            lessonButton('Sutinku', 'btn-primary', (btn) => lessonAction(btn, 'lesson_reschedule_answer', { p_lesson: l.id, p_accept: true })),
            lessonButton('Netinka', 'btn-ghost', (btn) => lessonAction(btn, 'lesson_reschedule_answer', { p_lesson: l.id, p_accept: false })),
          );
        }
      } else if (sameTime(l.starts_at, li.dataset.at) && l.state !== 'cancelled') {
        text.textContent = `Pamoka perkelta: ${to}.`;
      } else {
        text.textContent = `Pamoka neperkelta į ${to}.`;
      }
      return;
    }
    if (!l.starts_at) {
      // A lesson right now.
      if (l.state === 'open') {
        text.textContent = l.by_me ? 'Pakvietei į pamoką.' : `${name} kviečia į pamoką.`;
        actions.append(joinLink(l.id));
      } else {
        text.textContent = 'Pamoka baigėsi.';
      }
    } else if (l.state === 'proposed') {
      if (l.by_me) {
        text.textContent = `Pasiūlei pamoką: ${when}. Laukiama atsakymo.`;
        actions.append(lessonButton('Atšaukti pasiūlymą', 'btn-ghost', (btn) => lessonAction(btn, 'lesson_cancel', { p_lesson: l.id })));
      } else {
        text.textContent = `${name} siūlo pamoką: ${when}.`;
        actions.append(
          lessonButton('Sutinku', 'btn-primary', (btn) => lessonAction(btn, 'lesson_answer', { p_lesson: l.id, p_accept: true })),
          lessonButton('Netinka', 'btn-ghost', (btn) => lessonAction(btn, 'lesson_answer', { p_lesson: l.id, p_accept: false })),
        );
      }
    } else if (l.state === 'upcoming' || l.state === 'open') {
      text.textContent = `Pamoka sutarta: ${when}.`;
      if (l.state === 'open') actions.append(joinLink(l.id));
      else {
        if (!l.reschedule) actions.append(lessonButton('Perkelti', 'btn-ghost', () => openPlanner(l)));
        actions.append(lessonButton('Atšaukti pamoką', 'btn-ghost', () => askCancel(l)));
      }
    } else if (l.state === 'late') {
      text.textContent = {
        me: `Pamoka baigta, nes vėlavai: ${when}.`,
        them: `Pamoka baigta, nes ${name} vėlavo: ${when}.`,
        both: `Pamoka neįvyko, nes per 15 minučių niekas neprisijungė: ${when}.`,
      }[l.late] || `Pamoka baigėsi: ${when}.`;
    } else {
      text.textContent = `${{
        declined: 'Pasiūlymas atmestas', cancelled: 'Pamoka atšaukta', expired: 'Pasiūlymas nebegalioja', over: 'Pamoka baigėsi',
      }[l.state] || 'Pamoka'}: ${when}.`;
    }
  }

  // Calls an agreed lesson off, after a warning. The other student gets a
  // message; their agreement isn't needed.
  function askCancel(l) {
    const name = current ? current.full_name : '';
    if (lessonDialog.open) lessonDialog.close();
    askToConfirm({
      title: 'Atšaukti pamoką?',
      text: `Pamoka (${formatLessonTime(l.starts_at)}) nebeįvyks. ${name} gaus apie tai žinutę.`,
      ok: 'Atšaukti pamoką',
      run: async () => {
        const result = await lessonAction(null, 'lesson_cancel', { p_lesson: l.id });
        return result.ok ? result : { ok: false, formError: LESSON_ERRORS[result.error] || LESSON_ERRORS.failed };
      },
    });
  }
  // Set further down, where the calendar window lives.
  let openPlanner = () => {};

  let pendingLessonId = null; // The lesson time on the table with this student, if any.

  // The lessons with the open conversation's student, fresh from the
  // database: updates the cards, the two buttons and the line on top that
  // names the lesson that is running or comes next.
  async function refreshLessons() {
    if (!hasLessons || !current || !session || fetchMessages.plain) return;
    const partner = current;
    const res = await lessonRpc(session, 'lesson_list', { p_partner: partner.id });
    if (current !== partner) return;
    if (res.ok && Array.isArray(res.lessons)) {
      lessons = new Map(res.lessons.filter((l) => l && UUID_PATTERN.test(l.id || '')).map((l) => [l.id, l]));
      pendingLessonId = UUID_PATTERN.test(res.pending || '') ? res.pending : null;
      meetBtn.hidden = res.can_request !== true;
      planBtn.hidden = res.can_request !== true;
    }
    messagesEl.querySelectorAll('[data-lesson]').forEach(renderLessonCard);

    const all = [...lessons.values()];
    const next = all.find((l) => l.state === 'open')
      || all.filter((l) => l.state === 'upcoming').sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    nextBar.hidden = !next;
    if (!next) return;
    const label = document.createElement('p');
    label.textContent = next.state === 'upcoming'
      ? `Artimiausia pamoka: ${formatLessonTime(next.starts_at)}.`
      : (next.starts_at ? `Pamoka: ${formatLessonTime(next.starts_at)}. Jau galima prisijungti.` : 'Pamoka vyksta dabar.');
    nextBar.replaceChildren(label, ...(next.state === 'open' ? [joinLink(next.id)] : []));
  }

  const setComposerOpen = (open) => {
    composer.hidden = !open;
    closedEl.hidden = open;
    // Whoever can't be written to can't be invited either.
    if (hasLessons && !open) {
      meetBtn.hidden = true;
      planBtn.hidden = true;
    }
    let closedText = '';
    if (!open) {
      if (current && current.blocked_by_me) closedText = CHAT_BLOCKED_MSG;
      else closedText = schoolActive ? CHAT_CLOSED_MSG : CHAT_INACTIVE_MSG;
    }
    closedEl.textContent = closedText;
  };

  const setUrl = (partnerId) => {
    const url = partnerId ? `zinutes.html?su=${partnerId}` : 'zinutes.html';
    history.replaceState(null, '', url);
  };

  async function openConversation(partner) {
    current = partner;
    shownIds = new Set();
    messageEls = new Map();
    lastAt = null;
    lastDay = null;
    messagesEl.replaceChildren();
    showBanner(errorEl, '');
    input.value = '';
    input.style.height = '';

    document.getElementById('chat-partner-avatar').src = partner.avatar || DEFAULT_AVATAR;
    document.getElementById('chat-partner-name').textContent = partner.full_name;
    document.getElementById('chat-partner-username').textContent = partner.username ? `@${partner.username}` : '';
    setComposerOpen(partner.can_message);
    lessons = new Map();
    if (hasLessons) {
      // Shown again once the database says what is possible with this student.
      meetBtn.hidden = true;
      planBtn.hidden = true;
      nextBar.hidden = true;
    }
    noneEl.hidden = true;
    openEl.hidden = false;
    page.classList.add('is-thread-open');
    setUrl(partner.id);
    renderList();

    const messages = await fetchMessages(session, partner.id);
    if (current !== partner) return;
    if (!messages) {
      showBanner(errorEl, 'Nepavyko įkelti žinučių. Pabandyk dar kartą vėliau.');
      return;
    }
    if (!messages.length) {
      const first = document.createElement('li');
      first.className = 'chat-day';
      first.textContent = 'Parašyk pirmąją žinutę.';
      first.dataset.placeholder = '';
      messagesEl.appendChild(first);
    }
    appendMessages(messages, { forceScroll: true });
    refreshLessons();
    if (partner.can_message && window.matchMedia('(min-width: 860px)').matches) input.focus();

    const convo = conversations.find((c) => c.partner_id === partner.id);
    if (convo && convo.unread) {
      convo.unread = 0;
      renderList();
      markConversationRead(session, partner.id);
    }
  }

  const closeConversation = () => {
    page.classList.remove('is-thread-open');
    current = null;
    openEl.hidden = true;
    noneEl.hidden = false;
    setUrl(null);
    renderList();
  };
  document.getElementById('chat-back').addEventListener('click', closeConversation);

  // --- The other student's profile (click their name or picture) ---
  const profileDialog = document.getElementById('profile-dialog');
  const profileError = document.getElementById('profile-error');
  const profileDetails = document.getElementById('profile-details');

  const profileRow = (term, value) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    if (Array.isArray(value)) {
      const ul = document.createElement('ul');
      ul.className = 'account-doc-list';
      ul.append(...value.map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }));
      dd.appendChild(ul);
    } else {
      dd.textContent = value;
    }
    row.append(dt, dd);
    return row;
  };

  const fillProfile = (p) => {
    document.getElementById('profile-avatar').src = p.avatar || DEFAULT_AVATAR;
    document.getElementById('profile-name').textContent = p.full_name;
    document.getElementById('profile-username').textContent = p.username ? `@${p.username}` : '';
    document.getElementById('profile-teacher-mark').hidden = !p.is_teacher;
    const bio = document.getElementById('profile-bio');
    bio.textContent = p.bio || '';
    bio.hidden = !p.bio;

    const rows = [];
    if (p.grade) rows.push(profileRow('Klasė', GRADE_LABELS[p.grade] || `${p.grade} klasė`));
    if (p.school_name) rows.push(profileRow('Mokykla', p.school_name));
    if (p.is_teacher) {
      rows.push(profileRow(p.subjects.length === 1 ? 'Dalykas' : 'Dalykai', formatSubjects(p.subjects)));
      rows.push(profileRow('Moko', p.levels.map((key) => LEVEL_LABELS[key].replace(/ \(.*\)$/, '')).join(', ')));
      if (p.diplomas && p.diplomas.length) rows.push(profileRow('Patvirtinti diplomai ir pažymėjimai', p.diplomas));
      if (p.grades_verified) rows.push(profileRow('Pažymiai iš TAMO', 'Patvirtinti'));
    }
    profileDetails.replaceChildren(...rows);
    profileDetails.hidden = !rows.length;
  };

  document.getElementById('chat-partner-open').addEventListener('click', async () => {
    if (!current) return;
    const partner = current;
    // Show what is already known right away; the rest fills in once loaded.
    fillProfile({ ...partner, is_teacher: false });
    showBanner(profileError, '');
    profileDialog.showModal();
    const full = await fetchChatPartner(session, partner.id);
    if (current !== partner || !profileDialog.open) return;
    if (full) fillProfile(full);
    else showBanner(profileError, full === null ? 'Šio moksleivio profilis nepasiekiamas.' : 'Nepavyko įkelti profilio. Pabandyk dar kartą vėliau.');
  });
  // Clicking the dimmed area around the window closes it.
  profileDialog.addEventListener('click', (e) => {
    if (e.target === profileDialog) profileDialog.close();
  });

  // --- Menu: delete the chat, block ---
  const menuToggle = document.getElementById('chat-menu-toggle');
  const menu = document.getElementById('chat-menu');
  const hideBtn = document.getElementById('chat-hide');
  const blockBtn = document.getElementById('chat-block');

  const setMenuOpen = (open) => {
    menu.hidden = !open;
    menuToggle.setAttribute('aria-expanded', String(open));
    if (!open) return;
    // A chat with no messages yet has nothing to delete.
    hideBtn.hidden = !conversations.some((c) => current && c.partner_id === current.id);
    blockBtn.textContent = current && current.blocked_by_me ? 'Atblokuoti' : 'Užblokuoti';
    blockBtn.classList.toggle('is-danger', !(current && current.blocked_by_me));
    menu.querySelector('button:not([hidden])').focus();
  };
  menuToggle.addEventListener('click', () => setMenuOpen(menu.hidden));
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.chat-menu')) setMenuOpen(false);
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setMenuOpen(false);
      menuToggle.focus();
    }
  });

  // A warning window with one red button; run() resolves to { ok } or a failure.
  const confirmDialog = document.getElementById('chat-confirm');
  const confirmOk = document.getElementById('chat-confirm-ok');
  const confirmError = document.getElementById('chat-confirm-error');
  let confirmRun = null;
  const askToConfirm = ({ title, text, ok, run }) => {
    document.getElementById('chat-confirm-title').textContent = title;
    document.getElementById('chat-confirm-text').textContent = text;
    confirmOk.textContent = ok;
    showBanner(confirmError, '');
    confirmRun = run;
    confirmDialog.showModal();
  };
  confirmOk.addEventListener('click', async () => {
    if (!confirmRun) return;
    setBusy(confirmOk, true, 'Palaukite…');
    session = (await getSession()) || session;
    const result = await confirmRun();
    setBusy(confirmOk, false);
    if (!result.ok) {
      showBanner(confirmError, result.formError);
      return;
    }
    confirmRun = null;
    confirmDialog.close();
  });

  hideBtn.addEventListener('click', () => {
    setMenuOpen(false);
    const partner = current;
    askToConfirm({
      title: 'Ištrinti pokalbį?',
      text: 'Šis pokalbis dings iš tavo sąrašo. Jei vienas iš jūsų parašys dar kartą, jis vėl atsiras su visomis žinutėmis. Kitam moksleiviui pokalbis nedings.',
      ok: 'Ištrinti',
      run: async () => {
        const result = await hideConversation(session, partner.id);
        if (!result.ok) return result;
        conversations = conversations.filter((c) => c.partner_id !== partner.id);
        if (current === partner) closeConversation();
        else renderList();
        if (!conversations.length) showListEmpty('Dar neturi pokalbių. Susirask mokytoją ir parašyk pirmąją žinutę.', true);
        return result;
      },
    });
  });

  const applyBlock = async (partner, blocked) => {
    partner.blocked_by_me = blocked;
    await refreshList();
    const convo = conversations.find((c) => c.partner_id === partner.id);
    if (convo) partner.can_message = convo.can_reply;
    else {
      const fresh = await fetchChatPartner(session, partner.id);
      partner.can_message = Boolean(fresh && fresh.can_message);
    }
    if (current === partner) setComposerOpen(partner.can_message);
  };

  blockBtn.addEventListener('click', async () => {
    setMenuOpen(false);
    const partner = current;
    if (partner.blocked_by_me) {
      session = (await getSession()) || session;
      const result = await unblockUser(session, partner.id);
      if (!result.ok) showBanner(errorEl, result.formError);
      else await applyBlock(partner, false);
      return;
    }
    askToConfirm({
      title: 'Užblokuoti šį moksleivį?',
      text: 'Nei tu, nei šis moksleivis nebegalėsite vienas kitam rašyti ir nebematysite vienas kito mokytojų sąraše. Atblokuoti galėsi bet kada per šį meniu.',
      ok: 'Užblokuoti',
      run: async () => {
        const result = await blockUser(session, partner.id);
        if (result.ok) await applyBlock(partner, true);
        return result;
      },
    });
  });

  // --- Writing ---
  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };

  if (hasLessons) {
    // The camera button: a lesson right now. The other student gets an
    // invitation with a button in this chat; the lesson opens in a new tab.
    // (The tab has to be opened at the moment of the click, or browsers
    // block it; it gets its address once the lesson exists.)
    meetBtn.addEventListener('click', async () => {
      if (!current || meetBtn.disabled) return;
      const partner = current;
      showBanner(errorEl, '');
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      meetBtn.disabled = true;
      session = (await getSession()) || session;
      const result = await lessonRpc(session, 'lesson_request', { p_partner: partner.id, p_starts_at: null });
      meetBtn.disabled = false;
      if (!result.ok || !UUID_PATTERN.test(result.id || '')) {
        if (tab) tab.close();
        showBanner(errorEl, LESSON_ERRORS[result.error] || LESSON_ERRORS.failed);
        return;
      }
      if (tab && !tab.closed) tab.location.replace(lessonPageLink(result.id));
      else window.location.href = lessonPageLink(result.id);
      poll();
    });

    // The calendar button: propose a day and time, at most a year ahead.
    const lessonForm = document.getElementById('lesson-form');
    const lessonSend = document.getElementById('lesson-send');
    const lessonError = document.getElementById('lesson-error');
    const dateInput = lessonForm.elements.date;
    const timeInput = lessonForm.elements.time;
    const yearAhead = () => {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      return d;
    };

    // With a lesson time already on the table the calendar shows that one
    // instead, and what can be done about it.
    const busyView = document.getElementById('lesson-busy');
    const busyTitle = document.getElementById('lesson-busy-title');
    const busyText = document.getElementById('lesson-busy-text');
    const busyError = document.getElementById('lesson-busy-error');
    const busyActions = document.getElementById('lesson-busy-actions');

    const busyAction = (label, className, fn, body) => lessonButton(label, className, async (btn) => {
      showBanner(busyError, '');
      btn.disabled = true;
      session = (await getSession()) || session;
      const result = await lessonRpc(session, fn, body);
      btn.disabled = false;
      if (!result.ok) {
        showBanner(busyError, LESSON_ERRORS[result.error] || LESSON_ERRORS.failed);
        return;
      }
      lessonDialog.close();
      await refreshLessons();
      poll();
    });
    const closeButton = () => lessonButton('Uždaryti', 'btn-ghost', () => lessonDialog.close());

    function showBusy(l) {
      const name = current.full_name;
      const when = formatLessonTime(l.starts_at);
      let title = 'Pamoka jau suplanuota';
      let text = `Jūs jau sutarėte dėl pamokos: ${when}. Kitą galėsite suplanuoti, kai ši įvyks arba bus atšaukta.`;
      let actions = [
        lessonButton('Perkelti', 'btn-primary', () => openPlanner(l)),
        lessonButton('Atšaukti pamoką', 'btn-danger', () => askCancel(l)),
        closeButton(),
      ];
      if (l.state === 'open') {
        title = 'Pamoka jau prasideda';
        text = `Pamoka: ${when}. Jau galima prisijungti.`;
        actions = [joinLink(l.id), closeButton()];
      } else if (l.state === 'proposed' && l.by_me) {
        title = 'Laukiama atsakymo';
        text = `Pasiūlei pamoką: ${when}. Kitą laiką galėsi pasiūlyti, kai ${name} atsakys arba kai atsiimsi šį pasiūlymą.`;
        actions = [busyAction('Atsiimti pasiūlymą', 'btn-danger', 'lesson_cancel', { p_lesson: l.id }), closeButton()];
      } else if (l.state === 'proposed') {
        title = 'Laukia tavo atsakymo';
        text = `${name} siūlo pamoką: ${when}.`;
        actions = [
          busyAction('Sutinku', 'btn-primary', 'lesson_answer', { p_lesson: l.id, p_accept: true }),
          busyAction('Netinka', 'btn-ghost', 'lesson_answer', { p_lesson: l.id, p_accept: false }),
        ];
      } else if (l.reschedule === 'me') {
        text = `Pamoka: ${when}. Pasiūlei ją perkelti į ${formatLessonTime(l.reschedule_to)}. Laukiama, kol ${name} atsakys.`;
        actions = [lessonButton('Atšaukti pamoką', 'btn-danger', () => askCancel(l)), closeButton()];
      } else if (l.reschedule === 'them') {
        text = `Pamoka: ${when}. ${name} siūlo ją perkelti į ${formatLessonTime(l.reschedule_to)}.`;
        actions = [
          busyAction('Sutinku', 'btn-primary', 'lesson_reschedule_answer', { p_lesson: l.id, p_accept: true }),
          busyAction('Netinka', 'btn-ghost', 'lesson_reschedule_answer', { p_lesson: l.id, p_accept: false }),
        ];
      }
      busyTitle.textContent = title;
      busyText.textContent = text;
      showBanner(busyError, '');
      busyActions.replaceChildren(...actions);
      lessonForm.hidden = true;
      busyView.hidden = false;
      lessonDialog.setAttribute('aria-labelledby', 'lesson-busy-title');
      lessonDialog.showModal();
    }

    // The day-and-time window: a new lesson, or (moving = a lesson) a new
    // time for an agreed one.
    let moving = null;
    function showPlanner(lessonToMove) {
      moving = lessonToMove || null;
      lessonForm.reset();
      showBanner(lessonError, '');
      const from = moving ? new Date(moving.starts_at) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      dateInput.min = dateInputValue(new Date());
      dateInput.max = dateInputValue(yearAhead());
      dateInput.value = dateInputValue(from);
      timeInput.value = moving
        ? `${String(from.getHours()).padStart(2, '0')}:${String(from.getMinutes()).padStart(2, '0')}`
        : '16:00';
      document.getElementById('lesson-dialog-title').textContent = moving ? 'Perkelti pamoką' : 'Suplanuoti pamoką';
      lessonSend.textContent = moving ? 'Pasiūlyti naują laiką' : 'Pasiūlyti laiką';
      document.getElementById('lesson-dialog-text').textContent = moving
        ? `Dabar pamoka: ${formatLessonTime(moving.starts_at)}. Kol ${current.full_name} nesutiks su nauju laiku, galioja šis.`
        : `${current.full_name} turės sutikti su šiuo laiku.`;
      if (lessonDialog.open) lessonDialog.close();
      busyView.hidden = true;
      lessonForm.hidden = false;
      lessonDialog.setAttribute('aria-labelledby', 'lesson-dialog-title');
      lessonDialog.showModal();
    }

    planBtn.addEventListener('click', async () => {
      if (!current || planBtn.disabled) return;
      const partner = current;
      // Fresh, so it shows what is really on the table now.
      planBtn.disabled = true;
      await refreshLessons();
      planBtn.disabled = false;
      if (current !== partner) return;
      const pending = pendingLessonId && lessons.get(pendingLessonId);
      if (pending) showBusy(pending);
      else showPlanner();
    });
    openPlanner = (l) => showPlanner(l);
    document.getElementById('lesson-cancel').addEventListener('click', () => lessonDialog.close());
    [dateInput, timeInput].forEach((el) => el.addEventListener('input', () => showBanner(lessonError, '')));

    lessonForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!current) return;
      const partner = current;
      const at = new Date(`${dateInput.value}T${timeInput.value}`);
      if (!dateInput.value || !timeInput.value || Number.isNaN(at.getTime())) {
        showBanner(lessonError, 'Pasirink dieną ir laiką.');
        return;
      }
      if (at.getTime() < Date.now() + 5 * 60 * 1000 || at > yearAhead()) {
        showBanner(lessonError, LESSON_ERRORS.bad_time);
        return;
      }
      if (moving && at.getTime() === Date.parse(moving.starts_at)) {
        showBanner(lessonError, 'Pasirink kitą laiką nei dabartinis.');
        return;
      }
      setBusy(lessonSend, true, 'Siunčiama…');
      session = (await getSession()) || session;
      const result = moving
        ? await lessonRpc(session, 'lesson_reschedule', { p_lesson: moving.id, p_starts_at: at.toISOString() })
        : await lessonRpc(session, 'lesson_request', { p_partner: partner.id, p_starts_at: at.toISOString() });
      setBusy(lessonSend, false);
      if (!result.ok && result.error === 'already') {
        // The other student proposed a time meanwhile: show that one.
        lessonDialog.close();
        await refreshLessons();
        const pending = pendingLessonId && lessons.get(pendingLessonId);
        if (pending && current === partner) showBusy(pending);
        return;
      }
      if (!result.ok) {
        showBanner(lessonError, LESSON_ERRORS[result.error] || LESSON_ERRORS.failed);
        return;
      }
      lessonDialog.close();
      poll();
    });
  }
  input.addEventListener('input', () => {
    autoGrow();
    showBanner(errorEl, '');
  });
  // Enter sends, Shift+Enter starts a new line.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || !current || sendBtn.disabled) return;
    if (body.length > MESSAGE_MAX_LENGTH) {
      showBanner(errorEl, `Žinutė gali būti iki ${MESSAGE_MAX_LENGTH} simbolių.`);
      return;
    }

    const partner = current;
    setBusy(sendBtn, true, 'Siunčiama…');
    session = (await getSession()) || session;
    const result = await sendMessage(session, partner.id, body);
    setBusy(sendBtn, false);
    if (current !== partner) return;

    if (!result.ok) {
      if (result.closed) {
        partner.can_message = false;
        setComposerOpen(false);
      } else {
        showBanner(errorEl, result.formError);
      }
      return;
    }
    input.value = '';
    autoGrow();
    input.focus();
    messagesEl.querySelector('[data-placeholder]')?.remove();
    appendMessages([result.message], { forceScroll: true });
    refreshList();
  });

  // --- New messages, checked every few seconds while the tab is open ---
  const poll = async () => {
    if (document.visibilityState !== 'visible' || !session) return;
    session = (await getSession()) || session;
    if (!(await refreshList()) || !current) return;
    // Lessons change by themselves too (one opens when its time comes), and
    // the other student may have deleted a message.
    refreshLessons();
    checkDeleted();
    const convo = conversations.find((c) => c.partner_id === current.id);
    if (!convo || convo.last_at === lastAt) return;
    const partner = current;
    const fresh = await fetchMessages(session, partner.id, lastAt);
    if (current !== partner || !fresh) return;
    if (fresh.length) messagesEl.querySelector('[data-placeholder]')?.remove();
    appendMessages(fresh);
    if (fresh.some((m) => m.lesson_id)) refreshLessons();
    if (convo.unread) {
      convo.unread = 0;
      renderList();
      markConversationRead(session, partner.id);
    }
    if (convo.can_reply !== partner.can_message || Boolean(convo.blocked_by_me) !== partner.blocked_by_me) {
      partner.can_message = convo.can_reply;
      partner.blocked_by_me = Boolean(convo.blocked_by_me);
      setComposerOpen(partner.can_message);
    }
  };

  // --- Loading ---
  getSession().then(async (s) => {
    if (!s) {
      if (!readSession()) window.location.replace('prisijungti.html?next=zinutes.html');
      else showListEmpty(NETWORK_FAILED_MSG, false);
      return;
    }
    session = s;
    const [school, loaded] = await Promise.all([fetchMySchool(session), refreshList()]);
    schoolActive = !(school && !school.active);
    if (!loaded) {
      showListEmpty('Nepavyko įkelti pokalbių. Pabandyk dar kartą vėliau.', false);
      return;
    }

    // zinutes.html?su=<id> opens that conversation (e.g. from the teacher list).
    const wanted = new URLSearchParams(window.location.search).get('su');
    if (wanted && UUID_PATTERN.test(wanted)) {
      const convo = conversations.find((c) => c.partner_id === wanted);
      if (convo) {
        openConversation(partnerFromConvo(convo));
      } else {
        const partner = await fetchChatPartner(session, wanted);
        if (partner) openConversation(partner);
        else noneEl.querySelector('p').textContent = partner === null ? 'Šio moksleivio rasti nepavyko.' : 'Nepavyko atidaryti pokalbio. Pabandyk dar kartą vėliau.';
      }
    }

    setInterval(poll, CHAT_POLL_MS);
    document.addEventListener('visibilitychange', poll);
  });
}