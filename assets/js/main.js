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
  initAdminPage();
  initUsersPage();
  initSchoolsPage();
  initVerifyPage();
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

// Each [data-reveal] element fades and slides up once, as it comes into
// view, and then stays put. Its inline --reveal-delay staggers elements
// that come into view together (cards in a row, a heading and its text).
function initSectionReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;

  const showAll = () => targets.forEach((el) => el.classList.add('is-revealed'));
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    showAll();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      const delay = parseInt(getComputedStyle(entry.target).getPropertyValue('--reveal-delay'), 10) || 0;
      window.setTimeout(() => entry.target.classList.add('is-revealed'), Math.min(delay, 400));
    });
  // Starts once the element's top is a little above the bottom of the
  // screen, so it is seen moving rather than appearing already in place.
  }, { rootMargin: '0px 0px -8% 0px' });

  targets.forEach((el) => observer.observe(el));
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

  // Students' own pages, in the menu right after Apie (the order is: Apie,
  // Mokytojai, Susitikimai, Žinutės, Pagalba, then Administravimas for staff;
  // the logo stays first and the account button last).
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
    const about = menu.querySelector('a[href="apie.html"]');
    if (about) about.after(...links);
    else menu.prepend(...links);
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
    fetchStaffRoles(session).then((roles) => {
      if (roles.admin || roles.reviewer) finderLinks.push(...addAdminNavLink(currentPage));
    });
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
    initAccountRewards(session, Boolean(teacher));
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

// ---------------------------------------------------------------------------
// Administration (admin.html): one place for Mokify's own tools. Who may use
// which tool is decided by the database: admins (public.admins) create
// registration codes, reviewers (public.reviewers) check documents. Anyone
// with either role sees "Administravimas" in the menu.
// ---------------------------------------------------------------------------

// { admin, reviewer } for the signed-in student; both false if unknown.
async function fetchStaffRoles(session) {
  const ask = (fn) => callApi(`/rest/v1/rpc/${fn}`, { body: {}, token: session.access_token })
    .then((res) => res.ok && res.data === true);
  const [admin, reviewer] = await Promise.all([ask('is_admin'), ask('is_reviewer')]);
  return { admin, reviewer };
}

const ADMIN_PAGES = ['admin', 'tikrinimas', 'kodai', 'vartotojai', 'mokyklos'];

// Adds "Administravimas" to the menus, after Pagalba (the account button
// stays last).
function addAdminNavLink(currentPage) {
  return ['.nav-links', '.mobile-menu'].flatMap((selector) => {
    const menu = document.querySelector(selector);
    if (!menu || menu.querySelector('a[href="admin.html"]')) return [];
    const a = document.createElement('a');
    a.href = 'admin.html';
    a.textContent = 'Administravimas';
    if (ADMIN_PAGES.some((page) => currentPage.endsWith(`/${page}`))) a.setAttribute('aria-current', 'page');
    const help = menu.querySelector('a[href="pagalba.html"]');
    if (help) help.after(a);
    else menu.append(a);
    return [a];
  });
}

function initAdminPage() {
  const page = document.getElementById('admin');
  if (!page) return;
  if (!readSession()) {
    window.location.replace('prisijungti.html?next=admin.html');
    return;
  }

  const deny = () => {
    page.hidden = true;
    document.getElementById('admin-denied').hidden = false;
  };

  getSession().then(async (session) => {
    if (!session) {
      if (!readSession()) window.location.replace('prisijungti.html?next=admin.html');
      else showBanner(document.getElementById('admin-error'), NETWORK_FAILED_MSG);
      return;
    }
    const roles = await fetchStaffRoles(session);
    if (!roles.admin && !roles.reviewer) {
      deny();
      return;
    }
    const prefs = await reviewRpc(session, 'staff_prefs_get', {});
    initAdminTools(session, roles, prefs.ok && Array.isArray(prefs.tool_order) ? prefs.tool_order : []);

    // Schools whose subscription ends within 30 days, or has ended.
    if (roles.admin) {
      reviewRpc(session, 'admin_schools', {}).then((data) => {
        if (!data.ok || !Array.isArray(data.schools)) return;
        const today = data.today || isoDay(new Date());
        const soon = data.schools.filter((s) => {
          const left = daysBetween(today, s.subscription_ends);
          return left >= 0 && left <= SCHOOL_SOON_DAYS;
        }).length;
        const ended = data.schools.filter((s) => s.subscription_ends < today).length;
        const parts = [];
        if (soon) parts.push(`${soon} ${pluralLt(soon, 'prenumerata baigiasi', 'prenumeratos baigiasi', 'prenumeratų baigiasi')} per ${SCHOOL_SOON_DAYS} d.`);
        if (ended) parts.push(`${ended} ${pluralLt(ended, 'baigėsi', 'baigėsi', 'baigėsi')}`);
        document.getElementById('admin-schools-status').textContent = parts.join(', ');
      });
    }

    // How many documents are waiting to be checked.
    if (roles.reviewer) {
      const data = await reviewRpc(session, 'review_queue', { p_status: 'pending' });
      const waiting = data.ok && data.counts ? Number(data.counts.pending) || 0 : null;
      if (waiting !== null) {
        document.getElementById('admin-review-status').textContent = waiting
          ? `Laukia ${waiting} ${pluralLt(waiting, 'dokumentas', 'dokumentai', 'dokumentų')}`
          : 'Visi dokumentai patikrinti';
      }
    }
  });
}

// Which role each tool needs.
const ADMIN_TOOL_ROLES = { review: 'reviewer', codes: 'admin', schools: 'admin', users: 'admin' };

// The tools list on admin.html: shown in the student's saved order (tools
// added later come after, in the page's order). The pencil switches on
// rearranging: drag a tool (mouse or finger), or focus it and use the arrow
// keys. Every move is saved straight away.
function initAdminTools(session, roles, savedOrder) {
  const list = document.getElementById('admin-tools');
  const toggle = document.getElementById('admin-reorder');
  const error = document.getElementById('admin-error');
  const status = document.getElementById('admin-order-status');
  const page = document.getElementById('admin');
  const items = [...list.querySelectorAll('.admin-tool-item')];
  const toolOf = (item) => item.dataset.tool;
  const titleOf = (item) => item.querySelector('h2').textContent;

  items.forEach((item) => { item.hidden = !roles[ADMIN_TOOL_ROLES[toolOf(item)]]; });
  const rank = (item) => {
    const i = savedOrder.indexOf(toolOf(item));
    return i === -1 ? savedOrder.length + items.indexOf(item) : i;
  };
  list.append(...[...items].sort((a, b) => rank(a) - rank(b)));
  list.hidden = false;

  const visible = () => [...list.children].filter((item) => !item.hidden);
  toggle.hidden = visible().length < 2;

  let editing = false;
  let saving = Promise.resolve();
  const save = () => {
    const order = [...list.children].map(toolOf);
    saving = saving.then(async () => {
      const fresh = (await getSession()) || session;
      const res = await reviewRpc(fresh, 'staff_prefs_save', { p_tool_order: order, p_confirm_delete: null });
      showBanner(error, res.ok ? '' : 'Nepavyko išsaugoti įrankių tvarkos. Pabandyk dar kartą.');
    });
  };
  const announce = (item) => {
    status.textContent = `${titleOf(item)}: ${visible().indexOf(item) + 1} vieta iš ${visible().length}.`;
  };

  function setEditing(on) {
    editing = on;
    page.classList.toggle('is-reordering', on);
    toggle.setAttribute('aria-pressed', String(on));
    const label = on ? 'Baigti keisti tvarką' : 'Keisti įrankių tvarką';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    list.querySelectorAll('.admin-tool-item').forEach((item) => {
      const link = item.querySelector('a');
      if (on) {
        item.tabIndex = 0;
        item.setAttribute('aria-label', `${titleOf(item)}. Perkelk rodyklėmis aukštyn ir žemyn.`);
        link.tabIndex = -1;
      } else {
        item.removeAttribute('tabindex');
        item.removeAttribute('aria-label');
        link.removeAttribute('tabindex');
      }
    });
    if (on) visible()[0].focus();
  }
  toggle.addEventListener('click', () => setEditing(!editing));

  // While rearranging, the tools are not links.
  list.addEventListener('click', (e) => {
    if (editing && e.target.closest('a')) e.preventDefault();
  });

  list.addEventListener('keydown', (e) => {
    if (!editing || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const item = e.target.closest('.admin-tool-item');
    if (!item) return;
    const shown = visible();
    const to = shown[shown.indexOf(item) + (e.key === 'ArrowUp' ? -1 : 1)];
    if (!to) return;
    e.preventDefault();
    if (e.key === 'ArrowUp') to.before(item);
    else to.after(item);
    item.focus();
    announce(item);
    save();
  });

  // Dragging: the tool follows the pointer and changes places with a
  // neighbour once it passes the neighbour's middle.
  let drag = null;
  list.addEventListener('pointerdown', (e) => {
    if (!editing || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const item = e.target.closest('.admin-tool-item');
    if (!item) return;
    e.preventDefault();
    item.setPointerCapture(e.pointerId);
    drag = { item, id: e.pointerId, startY: e.clientY, moved: false };
    item.classList.add('is-dragging');
  });
  list.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { item } = drag;
    // Where the tool's top would be at this pointer position (layout
    // position + how far it has been dragged), compared with neighbours'
    // middles; a fast drag may pass several at once.
    for (;;) {
      const shown = visible();
      const i = shown.indexOf(item);
      const top = item.offsetTop + (e.clientY - drag.startY);
      const bottom = top + item.offsetHeight;
      const next = shown[i + 1];
      const prev = shown[i - 1];
      let neighbour = null;
      if (next && bottom > next.offsetTop + next.offsetHeight / 2) neighbour = next;
      else if (prev && top < prev.offsetTop + prev.offsetHeight / 2) neighbour = prev;
      if (!neighbour) break;
      const before = item.offsetTop;
      if (neighbour === next) next.after(item);
      else prev.before(item);
      drag.startY += item.offsetTop - before;
      drag.moved = true;
    }
    item.style.translate = `0 ${e.clientY - drag.startY}px`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { item, moved } = drag;
    drag = null;
    item.classList.remove('is-dragging');
    item.style.translate = '';
    if (moved) {
      announce(item);
      save();
    }
  };
  list.addEventListener('pointerup', endDrag);
  list.addEventListener('pointercancel', endDrag);
}

// ---------------------------------------------------------------------------
// Schools (mokyklos.html), for admins: change a school's name and contact,
// set or extend its subscription, delete it. Rules in
// supabase/updates/2026-11-21-admin-schools.sql.
// ---------------------------------------------------------------------------

const SCHOOL_SOON_DAYS = 30;

// Whole days from one "YYYY-MM-DD" to another (negative if b is earlier).
function daysBetween(a, b) {
  const day = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((day(b) - day(a)) / 86400000);
}

// "2027 m. rugpjūčio 31 d."
function formatLtDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('lt-LT', { year: 'numeric', month: 'long', day: 'numeric' });
}

const SCHOOLS_ERRORS = {
  network: NETWORK_FAILED_MSG,
  bad_name: 'Įvesk mokyklos pavadinimą (2–200 simbolių).',
  bad_email: 'Patikrink el. pašto adresą.',
  bad_date: 'Pasirink datą nuo 2020 m. iki dešimties metų į priekį.',
  bad_months: 'Pratęsti galima nuo 1 iki 60 mėnesių.',
  exists: 'Mokykla tokiu pavadinimu jau yra.',
  not_found: 'Šios mokyklos nebėra.',
  missing: 'Mokyklų valdymas dar neįjungtas.',
  failed: 'Nepavyko. Pabandyk dar kartą.',
};

function initSchoolsPage() {
  const page = document.getElementById('schools');
  if (!page) return;
  if (!readSession()) {
    window.location.replace('prisijungti.html?next=mokyklos.html');
    return;
  }

  const search = document.getElementById('schools-search');
  const error = document.getElementById('schools-error');
  const done = document.getElementById('schools-done');
  const count = document.getElementById('schools-count');
  const list = document.getElementById('schools-list');
  const dialog = document.getElementById('school-dialog');
  const form = document.getElementById('school-form');
  const nameInput = document.getElementById('school-edit-name');
  const emailInput = document.getElementById('school-edit-email');
  const endsInput = document.getElementById('school-edit-ends');
  const formError = document.getElementById('school-error');
  const saveBtn = document.getElementById('school-save');
  const confirmDialog = document.getElementById('school-confirm');
  const confirmError = document.getElementById('school-confirm-error');
  let schools = [];
  let today = isoDay(new Date());
  let open = null; // The school in the dialog.

  const deny = (text) => {
    page.hidden = true;
    if (text) document.getElementById('schools-denied-text').textContent = text;
    document.getElementById('schools-denied').hidden = false;
  };
  const rpc = async (fn, params) => {
    const session = await getSession();
    if (!session) return { ok: false, error: 'network' };
    return reviewRpc(session, fn, params);
  };
  const fail = (res, banner = error) => {
    if (res.error === 'forbidden') deny();
    else if (res.error === 'missing') deny(SCHOOLS_ERRORS.missing);
    else showBanner(banner, SCHOOLS_ERRORS[res.error] || SCHOOLS_ERRORS.failed);
  };

  const matches = (s) => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const text = `${s.name} ${s.contact_email || ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  };

  function statusOf(s) {
    const left = daysBetween(today, s.subscription_ends);
    if (left < 0) return { text: `Prenumerata baigėsi ${formatLtDate(s.subscription_ends)}`, cls: 'is-ended' };
    const when = `Prenumerata iki ${formatLtDate(s.subscription_ends)}`;
    if (left === 0) return { text: `${when} (baigiasi šiandien)`, cls: 'is-soon' };
    if (left <= SCHOOL_SOON_DAYS) return { text: `${when} (liko ${left} d.)`, cls: 'is-soon' };
    return { text: when, cls: '' };
  }

  function renderList() {
    const shown = schools.filter(matches);
    list.replaceChildren(...shown.map((s) => {
      const li = document.createElement('li');
      li.className = 'users-row schools-row';
      // The school's name and lines: a button that opens everything about it.
      const info = document.createElement('button');
      info.type = 'button';
      info.className = 'users-open schools-info';
      info.addEventListener('click', () => showInfo(s));
      const name = document.createElement('span');
      name.className = 'users-name';
      name.textContent = s.name;
      const status = statusOf(s);
      const when = document.createElement('span');
      when.className = `schools-status ${status.cls}`.trim();
      when.textContent = status.text;
      const meta = document.createElement('span');
      meta.className = 'users-meta text-muted';
      meta.textContent = [
        `${s.students} ${pluralLt(s.students, 'moksleivis', 'moksleiviai', 'moksleivių')}`,
        `${s.codes} ${pluralLt(s.codes, 'kodas', 'kodai', 'kodų')} (panaudota ${s.used})`,
        s.contact_email,
      ].filter(Boolean).join(' · ');
      info.append(name, when, meta);

      const actions = document.createElement('div');
      actions.className = 'schools-actions';
      const button = (label, aria, onClick, cls = 'btn btn-ghost btn-sm') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.textContent = label;
        b.setAttribute('aria-label', aria);
        b.addEventListener('click', () => onClick(b));
        return b;
      };
      actions.append(
        button('+1 mėn.', `Pratęsti „${s.name}“ prenumeratą mėnesiu`, (b) => extend(s, 1, b)),
        button('+1 metai', `Pratęsti „${s.name}“ prenumeratą metais`, (b) => extend(s, 12, b)),
        button('Keisti', `Keisti „${s.name}“`, () => showSchool(s)),
      );
      li.append(info, actions);
      return li;
    }));
    const word = pluralLt(shown.length, 'mokykla', 'mokyklos', 'mokyklų');
    count.textContent = search.value.trim() && shown.length !== schools.length
      ? `Rasta ${shown.length} ${word} iš ${schools.length}`
      : `${shown.length} ${word}`;
  }

  async function load() {
    const res = await rpc('admin_schools', {});
    if (!res.ok) {
      count.textContent = '';
      fail(res);
      return;
    }
    if (typeof res.today === 'string') today = res.today;
    schools = Array.isArray(res.schools) ? res.schools : [];
    renderList();
  }

  search.addEventListener('input', renderList);
  document.getElementById('schools-search-form').addEventListener('submit', (e) => e.preventDefault());

  const merge = (s, fresh) => {
    Object.assign(s, {
      name: fresh.name, contact_email: fresh.contact_email, subscription_ends: fresh.subscription_ends,
    });
    schools.sort((a, b) => a.name.localeCompare(b.name, 'lt'));
  };

  async function extend(s, months, btn) {
    showBanner(error, '');
    showBanner(done, '');
    setBusy(btn, true, '…');
    const res = await rpc('admin_extend_school', { p_school: s.id, p_months: months });
    setBusy(btn, false);
    if (!res.ok || !res.school) {
      fail(res);
      if (res.error === 'not_found') load();
      return;
    }
    merge(s, res.school);
    renderList();
    // (The date already ends with "d.", so no full stop after it.)
    showBanner(done, `„${s.name}“ prenumerata pratęsta iki ${formatLtDate(s.subscription_ends)}`);
  }

  // --- Everything about one school, and its codes -------------------------------

  const info = document.getElementById('school-info');
  const infoError = document.getElementById('school-info-error');
  const codesList = document.getElementById('school-codes');
  const codesShow = document.getElementById('school-codes-show');
  const codesMore = document.getElementById('school-codes-more');
  const codesDone = document.getElementById('school-codes-done');
  const codesConfirm = document.getElementById('codes-confirm');
  const CODE_STATES = { free: 'laisvas', used: 'panaudotas', pending: 'juo dabar registruojamasi' };
  const CODES_PAGE = 200;
  let detail = null; // { school (row in the list), data (admin_school's answer) }
  let codesShown = CODES_PAGE;

  const infoRow = (label, value) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  };
  const freeCodes = () => (detail ? detail.data.codes.filter((c) => c.state === 'free').map((c) => c.code) : []);

  function renderCounts() {
    const c = detail.data.counts;
    const parts = [`laisvi ${c.free}`, `panaudoti ${c.used}`];
    if (c.pending) parts.push(`dabar registruojamasi ${c.pending}`);
    document.getElementById('school-codes-counts').textContent =
      `Iš viso ${c.codes} ${pluralLt(c.codes, 'kodas', 'kodai', 'kodų')}: ${parts.join(', ')}.`;
    const none = c.free === 0;
    ['school-codes-copy', 'school-codes-download', 'school-codes-delete-all'].forEach((id) => {
      document.getElementById(id).disabled = none;
    });
  }

  function renderCodes() {
    const wanted = codesShow.value;
    const all = detail.data.codes.filter((c) => wanted === 'all' || c.state === wanted);
    const shown = all.slice(0, codesShown);
    codesList.replaceChildren(...shown.map((c) => {
      const li = document.createElement('li');
      li.className = 'users-row school-code';
      const text = document.createElement('span');
      text.className = 'school-code-text';
      const code = document.createElement('span');
      code.className = 'school-code-value';
      code.textContent = c.code;
      const state = document.createElement('span');
      state.className = `users-meta text-muted school-code-state is-${c.state}`;
      state.textContent = c.state === 'used' && c.username
        ? `${CODE_STATES.used} (@${c.username}, ${formatReviewTime(c.redeemed_at)})`
        : CODE_STATES[c.state] || c.state;
      text.append(code, state);
      li.appendChild(text);
      // Only a code nobody has can be deleted.
      if (c.state === 'free') {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-ghost btn-sm btn-danger-ghost';
        del.textContent = 'Ištrinti';
        del.setAttribute('aria-label', `Ištrinti kodą ${c.code}`);
        del.addEventListener('click', () => deleteCodes([c.code], del));
        li.appendChild(del);
      }
      return li;
    }));
    if (!all.length) {
      const li = document.createElement('li');
      li.className = 'users-row text-muted';
      li.textContent = wanted === 'all' ? 'Šiai mokyklai kodų dar nesukurta.' : 'Tokių kodų nėra.';
      codesList.appendChild(li);
    }
    codesMore.hidden = all.length <= shown.length;
    if (!codesMore.hidden) codesMore.textContent = `Rodyti daugiau (dar ${all.length - shown.length})`;
  }

  function renderInfo() {
    const { data } = detail;
    const sc = data.school;
    document.getElementById('school-info-name').textContent = sc.name;
    const status = statusOf(sc);
    const statusEl = document.getElementById('school-info-status');
    statusEl.textContent = status.text;
    statusEl.className = `schools-status ${status.cls}`.trim();
    const teachers = data.students.filter((s) => s.teacher).length;
    document.getElementById('school-info-details').replaceChildren(
      infoRow('Kontaktinis el. paštas', sc.contact_email || '—'),
      infoRow('Pridėta', formatReviewTime(sc.created_at)),
      infoRow('Moksleiviai', `${data.students.length}${teachers ? `, iš jų mokytojų ${teachers}` : ''}`),
    );
    document.getElementById('school-codes-new').href = `kodai.html?mokykla=${encodeURIComponent(sc.id)}`;
    renderCounts();
    renderCodes();

    const students = document.getElementById('school-students');
    document.getElementById('school-students-title').textContent = `Moksleiviai (${data.students.length})`;
    students.replaceChildren(...data.students.map((p) => {
      const li = document.createElement('li');
      li.className = 'users-row';
      const a = document.createElement('a');
      a.className = 'users-open';
      a.href = `vartotojai.html?q=${encodeURIComponent(p.username)}`;
      const name = document.createElement('span');
      name.className = 'users-name';
      name.textContent = p.full_name;
      if (p.teacher) {
        const tag = document.createElement('span');
        tag.className = 'users-roles';
        tag.textContent = 'Mokytojas';
        name.append(' ', tag);
      }
      const meta = document.createElement('span');
      meta.className = 'users-meta text-muted';
      meta.textContent = `@${p.username} · ${p.grade} klasė`;
      a.append(name, meta);
      li.appendChild(a);
      return li;
    }));
    if (!data.students.length) {
      const li = document.createElement('li');
      li.className = 'users-row text-muted';
      li.textContent = 'Moksleivių dar nėra.';
      students.appendChild(li);
    }

    const batches = document.getElementById('school-batches');
    batches.replaceChildren(...data.batches.map((b) => {
      const li = document.createElement('li');
      li.className = 'users-row users-meta';
      li.textContent = `${formatReviewTime(b.created_at)} · ${b.count} ${pluralLt(b.count, 'kodas', 'kodai', 'kodų')}${b.by ? ` · @${b.by}` : ''}`;
      return li;
    }));
    if (!data.batches.length) {
      const li = document.createElement('li');
      li.className = 'users-row text-muted';
      li.textContent = 'Kodai šiai mokyklai dar nekurti.';
      batches.appendChild(li);
    }
  }

  async function showInfo(s) {
    detail = null;
    showBanner(infoError, '');
    showBanner(codesDone, '');
    codesShow.value = 'all';
    codesShown = CODES_PAGE;
    document.getElementById('school-info-name').textContent = s.name;
    document.getElementById('school-info-status').textContent = 'Kraunama…';
    document.getElementById('school-info-details').replaceChildren();
    [codesList, document.getElementById('school-students'), document.getElementById('school-batches')].forEach((el) => el.replaceChildren());
    document.getElementById('school-codes-counts').textContent = '';
    codesMore.hidden = true;
    if (!info.open) info.showModal();
    const res = await rpc('admin_school', { p_school: s.id });
    if (!res.ok || !res.school) {
      fail(res, infoError);
      return;
    }
    if (typeof res.today === 'string') today = res.today;
    detail = { school: s, data: res };
    renderInfo();
  }

  // Deletes free codes (all of them when codes is null) and updates both
  // this window and the school's line in the list.
  async function deleteCodes(codes, btn) {
    if (!detail) return null;
    const { school, data } = detail;
    showBanner(codesDone, '');
    showBanner(infoError, '');
    if (btn) setBusy(btn, true, 'Trinama…');
    const res = await rpc('admin_delete_codes', { p_school: school.id, p_codes: codes });
    if (btn) setBusy(btn, false);
    if (!res.ok) {
      fail(res, infoError);
      return res;
    }
    const n = Number(res.deleted) || 0;
    // The real figures again, rather than guessing them here.
    const fresh = await rpc('admin_school', { p_school: school.id });
    if (fresh.ok && fresh.school && detail && detail.school === school) {
      detail.data = fresh;
      school.codes = Number(fresh.counts.codes) || 0;
      school.used = Number(fresh.counts.used) || 0;
    } else {
      const gone = new Set(codes || freeCodes());
      data.codes = data.codes.filter((c) => !(c.state === 'free' && gone.has(c.code)));
      data.counts.free = Math.max(0, data.counts.free - n);
      data.counts.codes = Math.max(0, data.counts.codes - n);
      school.codes = Math.max(0, school.codes - n);
    }
    renderInfo();
    renderList();
    showBanner(codesDone, n
      ? `${pluralLt(n, 'Ištrintas', 'Ištrinti', 'Ištrinta')} ${n} ${pluralLt(n, 'kodas', 'kodai', 'kodų')}.`
      : 'Nieko neištrinta: šie kodai jau panaudoti arba jais registruojamasi.');
    return res;
  }

  codesShow.addEventListener('change', () => {
    codesShown = CODES_PAGE;
    if (detail) renderCodes();
  });
  codesMore.addEventListener('click', () => {
    codesShown += CODES_PAGE;
    renderCodes();
  });

  document.getElementById('school-codes-copy').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const codes = freeCodes();
    if (!codes.length) return;
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      btn.textContent = 'Nukopijuota';
      window.clearTimeout(btn.resetTimer);
      btn.resetTimer = window.setTimeout(() => { btn.textContent = 'Kopijuoti laisvus'; }, 2500);
    } catch {
      showBanner(infoError, 'Nepavyko nukopijuoti. Atsisiųsk kodus failu.');
    }
  });

  // The free codes as a spreadsheet file, like on the codes page.
  document.getElementById('school-codes-download').addEventListener('click', () => {
    const codes = freeCodes();
    if (!codes.length || !detail) return;
    const name = `"${detail.data.school.name.replace(/"/g, '""')}"`;
    const csv = `﻿Mokykla,Kodas\r\n${codes.map((c) => `${name},${c}`).join('\r\n')}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mokify-laisvi-kodai-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById('school-codes-delete-all').addEventListener('click', () => {
    if (!detail) return;
    const n = detail.data.counts.free;
    showBanner(document.getElementById('codes-confirm-error'), '');
    document.getElementById('codes-confirm-text').textContent =
      `Visi ${n} „${detail.data.school.name}“ laisvi ${pluralLt(n, 'kodas', 'kodai', 'kodų')} bus ištrinti visam laikui. Panaudoti kodai ir tie, kuriais dabar registruojamasi, liks.`;
    codesConfirm.showModal();
  });
  document.getElementById('codes-confirm-ok').addEventListener('click', async (e) => {
    const res = await deleteCodes(null, e.currentTarget);
    if (res && res.ok) codesConfirm.close();
    else if (res) showBanner(document.getElementById('codes-confirm-error'), SCHOOLS_ERRORS[res.error] || SCHOOLS_ERRORS.failed);
  });

  document.getElementById('school-info-close').addEventListener('click', () => info.close());
  document.getElementById('school-info-edit').addEventListener('click', () => {
    if (!detail) return;
    const s = detail.school;
    info.close();
    showSchool(s);
  });

  // --- The dialog: change or delete one school ---------------------------------

  const setFieldError = (input, message) => {
    const field = input.closest('.field');
    field.classList.toggle('has-error', Boolean(message));
    field.querySelector('.field-error').textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  };
  const clearFormErrors = () => {
    [nameInput, emailInput, endsInput].forEach((input) => setFieldError(input, ''));
    showBanner(formError, '');
  };

  function showSchool(s) {
    open = s;
    clearFormErrors();
    showBanner(done, '');
    nameInput.value = s.name;
    emailInput.value = s.contact_email || '';
    endsInput.value = s.subscription_ends;
    const [y, m, d] = today.split('-').map(Number);
    endsInput.min = '2020-01-01';
    endsInput.max = `${y + 10}-${String(m).padStart(2, '0')}-${String(Math.min(d, 28)).padStart(2, '0')}`;
    dialog.showModal();
    nameInput.focus();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!open) return;
    clearFormErrors();
    const name = nameInput.value.trim().replace(/\s+/g, ' ');
    const email = emailInput.value.trim();
    let ok = true;
    if (name.length < 2 || name.length > 200) {
      setFieldError(nameInput, SCHOOLS_ERRORS.bad_name);
      ok = false;
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setFieldError(emailInput, SCHOOLS_ERRORS.bad_email);
      ok = false;
    }
    if (!endsInput.value || endsInput.value < endsInput.min || endsInput.value > endsInput.max) {
      setFieldError(endsInput, SCHOOLS_ERRORS.bad_date);
      ok = false;
    }
    if (!ok) return;

    const s = open;
    setBusy(saveBtn, true, 'Saugoma…');
    const res = await rpc('admin_update_school', {
      p_school: s.id, p_name: name, p_contact_email: email || null, p_subscription_ends: endsInput.value,
    });
    setBusy(saveBtn, false);
    if (!res.ok || !res.school) {
      const field = { bad_name: nameInput, exists: nameInput, bad_email: emailInput, bad_date: endsInput }[res.error];
      if (field) setFieldError(field, SCHOOLS_ERRORS[res.error]);
      else fail(res, formError);
      return;
    }
    merge(s, res.school);
    renderList();
    dialog.close();
    showBanner(done, `„${s.name}“ pakeitimai išsaugoti.`);
  });

  document.getElementById('school-close').addEventListener('click', () => dialog.close());

  document.getElementById('school-delete').addEventListener('click', () => {
    if (!open) return;
    const s = open;
    showBanner(confirmError, '');
    const okBtn = document.getElementById('school-confirm-ok');
    okBtn.hidden = s.students > 0;
    document.getElementById('school-confirm-text').textContent = s.students > 0
      ? `„${s.name}“ dar turi ${s.students} ${pluralLt(s.students, 'moksleivį', 'moksleivius', 'moksleivių')}. Mokyklą galima ištrinti tik tada, kai joje neliks moksleivių – juos gali ištrinti skiltyje „Vartotojai“.`
      : `„${s.name}“ ir visi ${s.codes} jos registracijos ${pluralLt(s.codes, 'kodas', 'kodai', 'kodų')} bus ištrinti visam laikui.`;
    confirmDialog.showModal();
  });

  document.getElementById('school-confirm-ok').addEventListener('click', async (e) => {
    if (!open) return;
    const s = open;
    const btn = e.currentTarget;
    setBusy(btn, true, 'Trinama…');
    const res = await rpc('admin_delete_school', { p_school: s.id });
    setBusy(btn, false);
    if (!res.ok) {
      if (res.error === 'has_students') {
        s.students = Number(res.students) || s.students;
        showBanner(confirmError, `Mokykloje yra ${s.students} ${pluralLt(s.students, 'moksleivis', 'moksleiviai', 'moksleivių')}, todėl jos ištrinti negalima.`);
        btn.hidden = true;
        renderList();
      } else {
        fail(res, confirmError);
      }
      return;
    }
    confirmDialog.close();
    dialog.close();
    schools = schools.filter((x) => x.id !== s.id);
    renderList();
    showBanner(done, `Mokykla „${s.name}“ ištrinta.`);
  });

  dialog.addEventListener('close', () => {
    if (!confirmDialog.open) open = null;
  });

  (async () => {
    const session = await getSession();
    if (!session) {
      if (!readSession()) window.location.replace('prisijungti.html?next=mokyklos.html');
      else showBanner(error, NETWORK_FAILED_MSG);
      return;
    }
    const roles = await fetchStaffRoles(session);
    if (!roles.admin) {
      deny();
      return;
    }
    load();
  })();
}

// ---------------------------------------------------------------------------
// User management (vartotojai.html), for admins: search, look at, change and
// delete users. The rules live in supabase/updates/2026-11-20-admin-users.sql
// (any name of 1-80 characters; a username keeps its login format; admins
// and oneself can't be deleted).
// ---------------------------------------------------------------------------

const USERS_ERRORS = {
  network: NETWORK_FAILED_MSG,
  bad_name: 'Vardas turi būti nuo 1 iki 80 simbolių.',
  bad_username: 'Vartotojo vardas: 3–20 simbolių, raidės be diakritikų, skaičiai, „_“ arba „.“ (su juo jungiamasi).',
  username_taken: 'Šis vartotojo vardas jau užimtas.',
  bad_grade: 'Pasirink klasę nuo 5 iki 12.',
  self: 'Savo paskyros čia ištrinti negali.',
  admin: 'Administratoriaus paskyros ištrinti negalima.',
  not_found: 'Šio vartotojo nebėra.',
  missing: 'Vartotojų valdymas dar neįjungtas.',
  failed: 'Nepavyko. Pabandyk dar kartą.',
};

function initUsersPage() {
  const page = document.getElementById('users');
  if (!page) return;
  if (!readSession()) {
    window.location.replace('prisijungti.html?next=vartotojai.html');
    return;
  }

  const search = document.getElementById('users-search');
  const confirmBox = document.getElementById('users-confirm');
  const error = document.getElementById('users-error');
  const count = document.getElementById('users-count');
  const list = document.getElementById('users-list');
  const dialog = document.getElementById('user-dialog');
  const form = document.getElementById('user-form');
  const nameInput = document.getElementById('user-full-name');
  const usernameInput = document.getElementById('user-username-input');
  const gradeInput = document.getElementById('user-grade');
  const formError = document.getElementById('user-error');
  const saveBtn = document.getElementById('user-save');
  const confirmDialog = document.getElementById('user-confirm');
  const confirmOk = document.getElementById('user-confirm-ok');
  let users = [];
  let total = 0;
  let open = null; // The user shown in the dialog.
  let pendingDelete = null;
  let searchToken = 0;

  const deny = (text) => {
    page.hidden = true;
    if (text) document.getElementById('users-denied-text').textContent = text;
    document.getElementById('users-denied').hidden = false;
  };
  const rpc = async (fn, params) => {
    const session = await getSession();
    if (!session) return { ok: false, error: 'network' };
    return reviewRpc(session, fn, params);
  };
  const fail = (res, banner = error) => {
    if (res.error === 'forbidden') deny();
    else if (res.error === 'missing') deny(USERS_ERRORS.missing);
    else showBanner(banner, USERS_ERRORS[res.error] || USERS_ERRORS.failed);
  };

  function userMeta(u) {
    return [`@${u.username}`, u.school, `${u.grade} klasė`].filter(Boolean).join(' · ');
  }

  function renderList() {
    list.replaceChildren(...users.map((u) => {
      const li = document.createElement('li');
      li.className = 'users-row';
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'users-open';
      const name = document.createElement('span');
      name.className = 'users-name';
      name.textContent = u.full_name;
      const roles = [u.me && 'Tu', u.admin && 'Administratorius', u.teacher && 'Mokytojas'].filter(Boolean);
      if (roles.length) {
        const tag = document.createElement('span');
        tag.className = 'users-roles';
        tag.textContent = roles.join(', ');
        name.append(' ', tag);
      }
      const meta = document.createElement('span');
      meta.className = 'users-meta text-muted';
      meta.textContent = `${userMeta(u)} · ${u.email}`;
      openBtn.append(name, meta);
      openBtn.addEventListener('click', () => showUser(u));
      li.appendChild(openBtn);
      // Admins (oneself included) can't be deleted, so they get no button.
      if (!u.me && !u.admin) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-ghost btn-sm btn-danger-ghost users-delete';
        del.textContent = 'Ištrinti';
        del.setAttribute('aria-label', `Ištrinti ${u.full_name} (@${u.username})`);
        del.addEventListener('click', () => askDelete(u, del));
        li.appendChild(del);
      }
      return li;
    }));
    const word = pluralLt(total, 'vartotojas', 'vartotojai', 'vartotojų');
    count.textContent = total > users.length
      ? `Rasta ${total} ${word}, rodoma ${users.length} naujausių`
      : `Rasta ${total} ${word}`;
  }

  async function load() {
    const token = ++searchToken;
    const res = await rpc('admin_users', { p_query: search.value.trim() });
    if (token !== searchToken) return;
    if (!res.ok) {
      count.textContent = '';
      fail(res);
      return;
    }
    showBanner(error, '');
    users = Array.isArray(res.users) ? res.users : [];
    total = Number(res.total) || users.length;
    renderList();
  }

  let searchTimer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(load, 250);
  });
  document.getElementById('users-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    window.clearTimeout(searchTimer);
    load();
  });

  // --- Deleting ---------------------------------------------------------------

  async function removeFiles(files) {
    const paths = (Array.isArray(files) ? files : []).filter((p) => typeof p === 'string');
    if (!paths.length) return;
    const { supabaseUrl, supabaseKey } = backendConfig();
    const session = await getSession();
    if (!session || !supabaseUrl) return;
    try {
      await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${TEACHER_BUCKET}`, {
        method: 'DELETE',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      });
    } catch {
      // The account is gone either way; a leftover file can be removed in Supabase.
    }
  }

  async function deleteUser(u, btn) {
    showBanner(error, '');
    if (btn) setBusy(btn, true, 'Trinama…');
    const res = await rpc('admin_delete_user', { p_user: u.id });
    if (!res.ok) {
      if (btn) setBusy(btn, false);
      fail(res);
      if (res.error === 'not_found') load();
      return false;
    }
    await removeFiles(res.files);
    users = users.filter((x) => x.id !== u.id);
    total = Math.max(0, total - 1);
    renderList();
    return true;
  }

  function askDelete(u, btn) {
    if (!confirmBox.checked) {
      deleteUser(u, btn);
      return;
    }
    pendingDelete = { u, btn };
    document.getElementById('user-confirm-text').textContent =
      `${u.full_name} (@${u.username}) paskyra ir viskas, kas su ja susiję – žinutės, pamokos, mokytojo profilis ir dokumentai – bus ištrinta visam laikui.`;
    confirmDialog.showModal();
  }
  confirmOk.addEventListener('click', async () => {
    if (!pendingDelete) return;
    const { u, btn } = pendingDelete;
    pendingDelete = null;
    confirmDialog.close();
    await deleteUser(u, btn);
  });
  confirmDialog.addEventListener('close', () => { pendingDelete = null; });

  confirmBox.addEventListener('change', async () => {
    const res = await rpc('staff_prefs_save', { p_tool_order: null, p_confirm_delete: confirmBox.checked });
    if (!res.ok) showBanner(error, 'Nepavyko išsaugoti nustatymo. Pabandyk dar kartą.');
  });

  // --- Looking at and changing one user ----------------------------------------

  const setFieldError = (input, message) => {
    const field = input.closest('.field');
    field.classList.toggle('has-error', Boolean(message));
    field.querySelector('.field-error').textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  };
  const clearFormErrors = () => {
    [nameInput, usernameInput, gradeInput].forEach((input) => setFieldError(input, ''));
    showBanner(formError, '');
  };

  const detail = (label, value) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  };

  function fillHeader(u) {
    document.getElementById('user-name').textContent = u.full_name;
    document.getElementById('user-username').textContent = `@${u.username}`;
  }

  // --- Adding and taking away points ------------------------------------------

  const pointsForm = document.getElementById('user-points-form');
  const pointsAmount = document.getElementById('user-points-amount');
  const pointsNote = document.getElementById('user-points-note');
  const pointsError = document.getElementById('user-points-error');
  const pointsDone = document.getElementById('user-points-done');
  const pointsAdd = document.getElementById('user-points-add');
  const pointsRemove = document.getElementById('user-points-remove');
  const POINTS_ERRORS = {
    bad_amount: 'Įvesk nuo 1 iki 100 000 taškų.',
    too_long: 'Priežastis gali būti iki 200 simbolių.',
  };

  // The badge with the user's total; no total (database not updated yet):
  // no points section.
  function setPoints(total) {
    const known = total !== undefined && total !== null;
    pointsForm.hidden = !known;
    if (known) document.getElementById('user-points-badge').replaceChildren(buildPointsBadge(total));
  }

  async function adjustPoints(sign, btn) {
    if (!open) return;
    showBanner(pointsError, '');
    showBanner(pointsDone, '');
    setFieldError(pointsAmount, '');
    const n = Number(pointsAmount.value);
    if (!Number.isInteger(n) || n < 1 || n > 100000) {
      setFieldError(pointsAmount, POINTS_ERRORS.bad_amount);
      return;
    }
    const row = open;
    setBusy(btn, true, 'Saugoma…');
    const res = await rpc('admin_adjust_points', { p_user: row.id, p_amount: sign * n, p_note: pointsNote.value.trim() || null });
    setBusy(btn, false);
    if (open !== row) return;
    if (!res.ok) {
      if (res.error === 'below_zero') {
        const total = Number(res.total) || 0;
        setFieldError(pointsAmount, `Tiek atimti negalima: vartotojas turi tik ${total} ${pluralLt(total, 'tašką', 'taškus', 'taškų')}.`);
      } else if (res.error === 'bad_amount') {
        setFieldError(pointsAmount, POINTS_ERRORS.bad_amount);
      } else {
        showBanner(pointsError, POINTS_ERRORS[res.error] || USERS_ERRORS[res.error] || USERS_ERRORS.failed);
      }
      return;
    }
    setPoints(res.total);
    pointsNote.value = '';
    const word = pluralLt(n, 'taškas', 'taškai', 'taškų');
    showBanner(pointsDone, sign > 0
      ? `${pluralLt(n, 'Pridėtas', 'Pridėti', 'Pridėta')} ${n} ${word}.`
      : `${pluralLt(n, 'Atimtas', 'Atimti', 'Atimta')} ${n} ${word}.`);
  }

  pointsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    adjustPoints(1, pointsAdd);
  });
  pointsRemove.addEventListener('click', () => adjustPoints(-1, pointsRemove));

  async function showUser(row) {
    open = row;
    clearFormErrors();
    showBanner(pointsError, '');
    showBanner(pointsDone, '');
    setFieldError(pointsAmount, '');
    pointsNote.value = '';
    pointsForm.hidden = true;
    fillHeader(row);
    document.getElementById('user-avatar').src = DEFAULT_AVATAR;
    document.getElementById('user-teacher-mark').hidden = !row.teacher;
    document.getElementById('user-bio').hidden = true;
    const details = document.getElementById('user-details');
    details.replaceChildren(detail('El. pašto adresas', row.email), detail('Mokykla', row.school || '—'));
    nameInput.value = row.full_name;
    usernameInput.value = row.username;
    gradeInput.value = String(row.grade);
    form.hidden = false;
    if (!dialog.open) dialog.showModal();

    const res = await rpc('admin_user', { p_user: row.id });
    if (open !== row) return;
    if (!res.ok || !res.user) {
      fail(res, formError);
      return;
    }
    const u = res.user;
    const avatar = typeof u.avatar === 'string' && (u.avatar === DEFAULT_AVATAR || u.avatar.startsWith('data:image/jpeg;base64,'))
      ? u.avatar : DEFAULT_AVATAR;
    document.getElementById('user-avatar').src = avatar;
    document.getElementById('user-teacher-mark').hidden = !u.teacher;
    const bio = document.getElementById('user-bio');
    bio.textContent = u.bio || '';
    bio.hidden = !u.bio;

    const rows = [
      detail('El. pašto adresas', u.email),
      detail('Mokykla', u.school ? `${u.school.name} (prenumerata iki ${u.school.subscription_ends})` : '—'),
      detail('Klasė', `${u.grade} klasė`),
      detail('Prisiregistravo', formatReviewTime(u.created_at)),
      detail('Paskutinį kartą prisijungė', u.last_sign_in_at ? formatReviewTime(u.last_sign_in_at) : '—'),
    ];
    if (u.teacher) {
      rows.push(detail('Moko', `${formatSubjects(u.teacher.subjects || [])} (${formatLevels(u.teacher.levels || [])})`));
      const d = u.documents || {};
      rows.push(detail('Dokumentai', `patvirtinti ${d.verified || 0}, laukia ${d.pending || 0}, nepatvirtinti ${d.rejected || 0}`));
    }
    rows.push(detail('Išsiuntė žinučių', String(u.messages_sent || 0)));
    rows.push(detail('Pamokų', String(u.lessons || 0)));
    if (Number(u.social_minutes) > 0) rows.push(detail('Socialinės valandos', `${formatHours(u.social_minutes)} val.`));
    setPoints(u.points);
    const roles = [u.admin && 'administratorius', u.reviewer && 'dokumentų tikrintojas'].filter(Boolean);
    if (roles.length) rows.push(detail('Vaidmenys', roles.join(', ')));
    details.replaceChildren(...rows);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!open) return;
    clearFormErrors();
    const fullName = nameInput.value.trim();
    const username = usernameInput.value.trim();
    let ok = true;
    if (fullName.length < 1 || fullName.length > 80) {
      setFieldError(nameInput, USERS_ERRORS.bad_name);
      ok = false;
    }
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) {
      setFieldError(usernameInput, USERS_ERRORS.bad_username);
      ok = false;
    }
    if (!ok) return;

    setBusy(saveBtn, true, 'Saugoma…');
    const row = open;
    const res = await rpc('admin_update_user', {
      p_user: row.id, p_full_name: fullName, p_username: username, p_grade: Number(gradeInput.value),
    });
    setBusy(saveBtn, false);
    if (!res.ok || !res.user) {
      const field = { bad_name: nameInput, bad_username: usernameInput, username_taken: usernameInput, bad_grade: gradeInput }[res.error];
      if (field) setFieldError(field, USERS_ERRORS[res.error]);
      else fail(res, formError);
      return;
    }
    Object.assign(row, { full_name: res.user.full_name, username: res.user.username, grade: res.user.grade });
    if (open === row) {
      fillHeader(row);
      nameInput.value = row.full_name;
      usernameInput.value = row.username;
    }
    renderList();
    saveBtn.textContent = 'Išsaugota';
    window.clearTimeout(saveBtn.resetTimer);
    saveBtn.resetTimer = window.setTimeout(() => { saveBtn.textContent = 'Išsaugoti'; }, 2000);
  });

  document.getElementById('user-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { open = null; });

  // Who may use the page, and their "ask before deleting" setting.
  (async () => {
    const session = await getSession();
    if (!session) {
      if (!readSession()) window.location.replace('prisijungti.html?next=vartotojai.html');
      else showBanner(error, NETWORK_FAILED_MSG);
      return;
    }
    const roles = await fetchStaffRoles(session);
    if (!roles.admin) {
      deny();
      return;
    }
    const prefs = await reviewRpc(session, 'staff_prefs_get', {});
    if (prefs.ok) confirmBox.checked = prefs.confirm_delete !== false;
    // Opened from a school's list of students: that student's search.
    const asked = new URLSearchParams(window.location.search).get('q');
    if (asked) search.value = asked.slice(0, 100);
    load();
  })();
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
  const schoolSearch = document.getElementById('codes-school-search');
  const error = document.getElementById('codes-error');
  const done = document.getElementById('codes-done');
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
    showBanner(done, '');
  };

  // A new school can be added with no codes (they can be made later), so
  // then the count may be 0 and the button says what will happen.
  const minCount = () => (select.value === NEW_SCHOOL ? 0 : 1);
  const updateSubmitLabel = () => {
    if (submit.disabled && submit.dataset.label) return;
    const count = Number(countInput.value);
    submit.textContent = select.value !== NEW_SCHOOL
      ? 'Sukurti kodus'
      : (count === 0 ? 'Sukurti mokyklą' : 'Sukurti mokyklą ir kodus');
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
    const adding = select.value === NEW_SCHOOL;
    newBox.hidden = !adding;
    countInput.min = String(minCount());
    // Adding a school: by default without codes; picking one: 30 codes.
    if (adding && countInput.dataset.mode !== 'new') countInput.value = '0';
    if (!adding && countInput.dataset.mode === 'new' && Number(countInput.value) === 0) countInput.value = '30';
    countInput.dataset.mode = adding ? 'new' : 'existing';
    updateSubmitLabel();
  };

  // The search box narrows the list to schools whose name has every typed
  // word. The chosen school stays in the list, and a single match is chosen.
  const matchesSearch = (s) => {
    const words = schoolSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
    const name = s.name.toLowerCase();
    return words.every((w) => name.includes(w));
  };

  function fillSchools(selectId) {
    const current = selectId || select.value;
    const searching = schoolSearch.value.trim() !== '';
    const shown = schools.filter((s) => s.id === current || matchesSearch(s));
    const options = shown.map((s) => {
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
    placeholder.textContent = searching && !shown.length ? 'Tokios mokyklos nėra' : 'Pasirink mokyklą';
    const add = document.createElement('option');
    add.value = NEW_SCHOOL;
    add.textContent = 'Pridėti naują mokyklą…';
    select.replaceChildren(placeholder, ...options, add);
    const usable = shown.filter((s) => s.subscription_ends >= today);
    if (current === NEW_SCHOOL) select.value = NEW_SCHOOL;
    else if (current && shown.some((s) => s.id === current)) select.value = current;
    else if (searching && usable.length === 1) select.value = usable[0].id;
    else select.value = schools.length ? '' : NEW_SCHOOL;
    showNewFields();
  }

  schoolSearch.addEventListener('input', () => {
    // A new search starts from no choice, unless adding a school.
    if (select.value !== NEW_SCHOOL) select.value = '';
    fillSchools();
  });

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
    if (countInput.value.trim() === '' || !Number.isInteger(count) || count < minCount() || count > CODES_MAX) {
      setError(countInput, minCount() === 0 ? `Galima sukurti nuo 0 iki ${CODES_MAX} kodų.` : CODES_ERRORS.bad_count);
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
      const count = Number(countInput.value);
      schoolSearch.value = '';
      fillSchools(schoolId);
      nameInput.value = '';
      emailInput.value = '';
      // Only the school was wanted: it stays chosen, ready for codes later.
      if (count === 0) {
        setBusy(submit, false);
        updateSubmitLabel();
        showBanner(done, `Mokykla „${created.school.name}“ pridėta. Jos kodus gali sukurti dabar arba vėliau.`);
        return;
      }
      countInput.value = String(count);
    }

    const count = Number(countInput.value);
    const data = await reviewRpc(session, 'admin_generate_codes', { p_school: schoolId, p_count: count });
    setBusy(submit, false);
    updateSubmitLabel();
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
    showBanner(done, '');
    showNewFields();
    if (select.value === NEW_SCHOOL) nameInput.focus();
  });
  countInput.addEventListener('input', updateSubmitLabel);

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
  // Opened from a school's page ("Kurti naujų kodų"): that school chosen.
  loadSchools(new URLSearchParams(window.location.search).get('mokykla') || undefined);
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
  bad_duration: 'Pamoka gali trukti nuo 15 minučių iki 4 valandų.',
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
  let res = await callApi(`/rest/v1/rpc/${fn}`, { body, token: session.access_token });
  // A database without lesson lengths yet (2026-11-22-lesson-length-points.sql
  // not run): ask again without one, so lessons still work.
  if (res.status === 404 && body && 'p_duration' in body) {
    const { p_duration: _ignored, ...rest } = body;
    res = await callApi(`/rest/v1/rpc/${fn}`, { body: rest, token: session.access_token });
  }
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

// A lesson's length: "45 min.", "1 val.", "1 val. 30 min."
function formatDuration(minutes) {
  const m = Number(minutes) || 0;
  if (m < 60) return `${m} min.`;
  return m % 60 ? `${Math.floor(m / 60)} val. ${m % 60} min.` : `${m / 60} val.`;
}
// The lengths a lesson can have: 15 minutes to 4 hours, every 15 minutes.
const LESSON_DURATIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);
const LESSON_DEFAULT_DURATION = 60;

// --- Rewards: points and social hours (account page, end of a lesson) -------

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}) => {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};

// Social hours as people write them: 30 -> "0,5", 90 -> "1,5", 60 -> "1".
const formatHours = (minutes) => String(Math.round((Number(minutes) || 0) / 6) / 10).replace('.', ',');

// The public page that checks a certificate.
function hoursUrl(code) {
  const local = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
  return `${window.location.origin}/${local ? 'patvirtinimas.html' : 'patvirtinimas'}?k=${encodeURIComponent(code)}`;
}

// A QR code as an SVG (assets/js/vendor/qrcode.js does the encoding).
function buildQr(text) {
  if (typeof qrcode !== 'function') return null;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const size = n + quiet * 2;
  let d = '';
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (qr.isDark(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': 'QR kodas', 'shape-rendering': 'crispEdges' });
  svg.append(svgEl('rect', { width: size, height: size, fill: '#fff' }), svgEl('path', { d, fill: '#201E1B' }));
  return svg;
}

// A gold star with a light shine on its upper half.
let starCount = 0;
function buildStar() {
  starCount += 1;
  const id = `star-${starCount}`;
  const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  const defs = svgEl('defs');
  const g = svgEl('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' });
  g.append(
    svgEl('stop', { offset: '0%', 'stop-color': '#FFE680' }),
    svgEl('stop', { offset: '55%', 'stop-color': '#FFC21A' }),
    svgEl('stop', { offset: '100%', 'stop-color': '#E89400' }),
  );
  defs.appendChild(g);
  const points = 'M12 1.8l3.05 6.5 7.1.86-5.24 4.88 1.37 7.03L12 17.6l-6.28 3.47 1.37-7.03L1.85 9.16l7.1-.86z';
  svg.append(
    defs,
    svgEl('path', { class: 'star-shape', d: points, fill: `url(#${id})`, stroke: '#B97200', 'stroke-width': '0.9', 'stroke-linejoin': 'round' }),
    svgEl('path', { class: 'star-shine', d: 'M12 4.6l1.9 4.05 3.3.4L12 10.6 6.8 9.05l3.3-.4z', fill: '#FFF7CC', opacity: '0.85' }),
  );
  return svg;
}

// Counts a number up to its value (just shows it, for reduced motion).
function countUp(el, to, prefix = '') {
  const end = Number(to) || 0;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || end <= 0) {
    el.textContent = `${prefix}${end}`;
    return;
  }
  const start = performance.now();
  const ms = Math.min(1400, 500 + end * 4);
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = `${prefix}${Math.round(end * (1 - (1 - t) ** 3))}`;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const textEl = (tag, className, text) => {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
};

// The round points badge beside a name: a star over the total.
function buildPointsBadge(total) {
  const value = Number(total) || 0;
  const badge = document.createElement('span');
  badge.className = 'points-badge';
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', `${value} ${pluralLt(value, 'taškas', 'taškai', 'taškų')}`);
  badge.title = badge.getAttribute('aria-label');
  const star = document.createElement('span');
  star.className = 'points-badge-star';
  star.appendChild(buildStar());
  const number = textEl('span', 'points-badge-value', '0');
  badge.append(star, number);
  countUp(number, value);
  return badge;
}

// The points card at the end of a lesson: star + big number ("+50").
function buildPointsReward({ value, gained = false, sub = '' }) {
  const card = document.createElement('div');
  card.className = 'reward reward--points';
  const star = document.createElement('span');
  star.className = 'reward-star';
  star.appendChild(buildStar());
  const body = document.createElement('span');
  body.className = 'reward-body';
  const number = textEl('span', 'reward-value', `${gained ? '+' : ''}0`);
  body.append(number, textEl('span', 'reward-label', pluralLt(Number(value) || 0, 'taškas', 'taškai', 'taškų')));
  if (sub) body.appendChild(textEl('span', 'reward-sub', sub));
  card.append(star, body);
  countUp(number, value, gained ? '+' : '');
  return card;
}

// The social hours card: big number (+ an optional button on the right).
function buildHoursReward({ minutes, gained = false, sub = '', button = null }) {
  const card = document.createElement('div');
  card.className = 'reward reward--hours';
  const body = document.createElement('span');
  body.className = 'reward-body';
  const hours = formatHours(minutes);
  body.append(
    textEl('span', 'reward-value', `${gained ? '+' : ''}${hours}`),
    // 0,5 / 1,5 socialinės valandos; 1 socialinė valanda; 2 socialinės valandos; 10 socialinių valandų.
    textEl('span', 'reward-label', hours.includes(',') ? 'socialinės valandos' : pluralLt(Number(hours), 'socialinė valanda', 'socialinės valandos', 'socialinių valandų')),
  );
  if (sub) body.appendChild(textEl('span', 'reward-sub', sub));
  card.appendChild(body);
  if (button) card.appendChild(button);
  return card;
}

// A certificate: its QR code, the link it opens, and copying that link.
function buildHoursCert(code) {
  const cert = document.createElement('div');
  cert.className = 'hours-cert';
  const url = hoursUrl(code);
  const qr = buildQr(url);
  if (qr) {
    const box = document.createElement('div');
    box.className = 'hours-qr';
    box.appendChild(qr);
    cert.appendChild(box);
  }
  cert.appendChild(textEl('p', 'text-muted', 'Nuskenuokite, kad patikrintumėte.'));
  const link = document.createElement('a');
  link.className = 'hours-link';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = url.replace(/^https?:\/\//, '');
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn btn-ghost btn-sm';
  copy.textContent = 'Kopijuoti nuorodą';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = 'Nukopijuota';
      window.clearTimeout(copy.resetTimer);
      copy.resetTimer = window.setTimeout(() => { copy.textContent = 'Kopijuoti nuorodą'; }, 2500);
    } catch {
      window.prompt('Nukopijuok nuorodą:', url);
    }
  });
  cert.append(link, copy);
  return cert;
}

// The end of a finished lesson (pamoka.html): the points it gave, and for
// its teacher the social hours with their certificate.
function renderLessonRewards(container, res) {
  const parts = [];
  const points = Number(res.points) || 0;
  if (points) {
    const total = Number(res.points_total) || 0;
    parts.push(buildPointsReward({ value: points, gained: true, sub: total ? `Iš viso: ${total} ${pluralLt(total, 'taškas', 'taškai', 'taškų')}` : '' }));
  }
  if (res.hours && res.hours.code) {
    const total = Number(res.hours.total) || 0;
    parts.push(buildHoursReward({ minutes: res.hours.minutes, gained: true, sub: total ? `Iš viso: ${formatHours(total)} val.` : '' }));
    parts.push(buildHoursCert(res.hours.code));
  }
  container.replaceChildren(...parts);
  container.hidden = !parts.length;
}

// patvirtinimas.html?k=<code>: anyone (also not logged in) checks that a
// social hours certificate is real. The database answers only for that one
// code (verify_social_hours in supabase/updates/2026-11-23-rewards.sql).
async function initVerifyPage() {
  const page = document.getElementById('verify');
  if (!page) return;
  const status = document.getElementById('verify-status');
  const details = document.getElementById('verify-details');
  const note = document.getElementById('verify-note');
  const code = (new URLSearchParams(window.location.search).get('k') || '').trim().toLowerCase();
  const invalid = (text) => {
    status.textContent = text;
    status.className = 'verify-status is-invalid';
  };
  if (!/^[a-z2-9]{20}$/.test(code)) {
    invalid('Tokia pažyma nerasta. Patikrink, ar nuoroda nukopijuota visa.');
    return;
  }
  const res = await callApi('/rest/v1/rpc/verify_social_hours', { body: { p_code: code } });
  if (!res.ok) {
    invalid(res.status === 0 ? NETWORK_FAILED_MSG : 'Patikrinti nepavyko. Pabandyk dar kartą vėliau.');
    return;
  }
  const v = res.data || {};
  if (v.ok !== true) {
    invalid('Tokia pažyma nerasta. Patikrink, ar nuoroda nukopijuota visa.');
    return;
  }
  status.textContent = 'Patvirtinta: šios socialinės valandos tikros.';
  status.className = 'verify-status is-valid';
  const row = (label, value) => {
    const div = document.createElement('div');
    div.append(textEl('dt', '', label), textEl('dd', '', value));
    return div;
  };
  details.replaceChildren(
    row('Moksleivis', v.name),
    row('Mokykla', v.school),
    row('Socialinės valandos', `${formatHours(v.minutes)} val. (${v.minutes} min.)`),
    row('Už pamoką', `${formatReviewTime(v.lesson_at)}, ${formatDuration(v.lesson_minutes)}`),
    row('Išduota', formatReviewTime(v.issued_at)),
  );
  details.hidden = false;
  note.textContent = 'Valandos skiriamos moksleiviui, kuris Mokify platformoje vedė pamoką kitam moksleiviui ir ji įvyko iki galo.';
  note.hidden = false;
}

// paskyra.html: the points total, and for teachers (or anyone who has some)
// the social hours, whose certificates open in a window.
async function initAccountRewards(session, isTeacher) {
  const box = document.getElementById('account-rewards');
  if (!box) return;
  const ask = (fn) => callApi(`/rest/v1/rpc/${fn}`, { body: {}, token: session.access_token })
    .then((res) => (res.ok && res.data && res.data.ok === true ? res.data : null));
  const [points, hours] = await Promise.all([ask('my_points'), ask('my_social_hours')]);
  // The points: a round badge beside the name.
  const slot = document.getElementById('account-points');
  if (points && slot) {
    slot.replaceChildren(buildPointsBadge(points.total));
    slot.hidden = false;
  }
  const cards = [];
  const items = hours && Array.isArray(hours.items) ? hours.items : [];
  if (hours && (isTeacher || items.length)) {
    let button = null;
    if (items.length) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-ghost btn-sm';
      button.textContent = 'Pažymos';
      button.addEventListener('click', () => showHoursCertificates(items));
    }
    cards.push(buildHoursReward({
      minutes: hours.minutes,
      sub: items.length ? `Už ${items.length} ${pluralLt(items.length, 'pamoką', 'pamokas', 'pamokų')}` : 'Už vedamas pamokas',
      button,
    }));
  }
  box.replaceChildren(...cards);
  box.hidden = !cards.length;
}

// The certificates window: one line per lesson; choosing one shows its QR
// code and link.
function showHoursCertificates(items) {
  const dialog = document.getElementById('hours-dialog');
  const list = document.getElementById('hours-list');
  const slot = document.getElementById('hours-cert');
  const show = (item, button, scroll) => {
    list.querySelectorAll('[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    button.setAttribute('aria-pressed', 'true');
    slot.replaceChildren(buildHoursCert(item.code));
    if (scroll) slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const buttons = items.map((item) => {
    const li = document.createElement('li');
    li.className = 'users-row';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'users-open';
    b.setAttribute('aria-pressed', 'false');
    b.append(
      textEl('span', 'users-name', `${formatHours(item.minutes)} val.`),
      textEl('span', 'users-meta text-muted', `Pamoka ${formatReviewTime(item.lesson_at)} · ${formatDuration(item.lesson_minutes)}`),
    );
    b.addEventListener('click', () => show(item, b, true));
    li.appendChild(b);
    list.appendChild(li);
    return b;
  });
  list.replaceChildren(...buttons.map((b) => b.parentElement));
  if (items[0]) show(items[0], buttons[0]);
  dialog.showModal();
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
    const length = l.duration ? formatDuration(l.duration) : '';
    // "penktadienis, lapkričio 14 d., 16:00, 1 val."
    const whenLong = when && length ? `${when}, ${length}` : when;
    // A sentence ends with one full stop, also after "val." or "min.".
    const sentence = (s) => (s.endsWith('.') ? s : `${s}.`);
    const earned = l.points ? ` Gavai ${l.points} ${pluralLt(l.points, 'tašką', 'taškus', 'taškų')}.` : '';
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
      const lasting = length ? ` (${length})` : '';
      if (l.state === 'open') {
        text.textContent = l.by_me ? `Pakvietei į pamoką${lasting}.` : `${name} kviečia į pamoką${lasting}.`;
        actions.append(joinLink(l.id));
      } else {
        text.textContent = `Pamoka baigėsi.${earned}`;
      }
    } else if (l.state === 'proposed') {
      if (l.by_me) {
        text.textContent = `${sentence(`Pasiūlei pamoką: ${whenLong}`)} Laukiama atsakymo.`;
        actions.append(lessonButton('Atšaukti pasiūlymą', 'btn-ghost', (btn) => lessonAction(btn, 'lesson_cancel', { p_lesson: l.id })));
      } else {
        text.textContent = sentence(`${name} siūlo pamoką: ${whenLong}`);
        actions.append(
          lessonButton('Sutinku', 'btn-primary', (btn) => lessonAction(btn, 'lesson_answer', { p_lesson: l.id, p_accept: true })),
          lessonButton('Netinka', 'btn-ghost', (btn) => lessonAction(btn, 'lesson_answer', { p_lesson: l.id, p_accept: false })),
        );
      }
    } else if (l.state === 'upcoming' || l.state === 'open') {
      text.textContent = sentence(`Pamoka sutarta: ${whenLong}`);
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
      }[l.state] || 'Pamoka'}: ${when}.${l.state === 'over' ? earned : ''}`;
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
    // The camera button: a lesson right now, after choosing how long it
    // lasts. The other student gets an invitation with a button in this
    // chat; the lesson opens in a new tab. (The tab has to be opened at the
    // moment of the click on "Pakviesti", or browsers block it; it gets its
    // address once the lesson exists.)
    async function inviteNow(partner, duration) {
      showBanner(errorEl, '');
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      meetBtn.disabled = true;
      session = (await getSession()) || session;
      const result = await lessonRpc(session, 'lesson_request', { p_partner: partner.id, p_starts_at: null, p_duration: duration });
      meetBtn.disabled = false;
      if (!result.ok || !UUID_PATTERN.test(result.id || '')) {
        if (tab) tab.close();
        return result;
      }
      if (tab && !tab.closed) tab.location.replace(lessonPageLink(result.id));
      else window.location.href = lessonPageLink(result.id);
      poll();
      return result;
    }

    // The calendar button: propose a day and time, at most a year ahead.
    const lessonForm = document.getElementById('lesson-form');
    const lessonSend = document.getElementById('lesson-send');
    const lessonError = document.getElementById('lesson-error');
    const dateInput = lessonForm.elements.date;
    const timeInput = lessonForm.elements.time;
    const durationInput = lessonForm.elements.duration;
    durationInput.replaceChildren(...LESSON_DURATIONS.map((m) => {
      const option = document.createElement('option');
      option.value = String(m);
      option.textContent = formatDuration(m);
      return option;
    }));
    // 'plan' (a new time), 'move' (a new time for an agreed lesson) or 'now'.
    let lessonMode = 'plan';
    const setLessonFields = () => {
      document.getElementById('lesson-date-field').hidden = lessonMode === 'now';
      document.getElementById('lesson-time-field').hidden = lessonMode === 'now';
      // Moving keeps the lesson's length.
      document.getElementById('lesson-duration-field').hidden = lessonMode === 'move';
    };
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
      lessonMode = moving ? 'move' : 'plan';
      lessonForm.reset();
      durationInput.value = String(LESSON_DEFAULT_DURATION);
      setLessonFields();
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

    // The "now" window: only how long the lesson lasts.
    function showNow() {
      moving = null;
      lessonMode = 'now';
      lessonForm.reset();
      durationInput.value = String(LESSON_DEFAULT_DURATION);
      setLessonFields();
      showBanner(lessonError, '');
      document.getElementById('lesson-dialog-title').textContent = 'Pamoka dabar';
      document.getElementById('lesson-dialog-text').textContent = `${current.full_name} gaus kvietimą prisijungti dabar.`;
      lessonSend.textContent = 'Pakviesti';
      if (lessonDialog.open) lessonDialog.close();
      busyView.hidden = true;
      lessonForm.hidden = false;
      lessonDialog.setAttribute('aria-labelledby', 'lesson-dialog-title');
      lessonDialog.showModal();
      durationInput.focus();
    }

    meetBtn.addEventListener('click', () => {
      if (!current || meetBtn.disabled) return;
      showBanner(errorEl, '');
      showNow();
    });

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
      const duration = Number(durationInput.value);
      if (lessonMode !== 'move' && !LESSON_DURATIONS.includes(duration)) {
        showBanner(lessonError, LESSON_ERRORS.bad_duration);
        return;
      }
      if (lessonMode === 'now') {
        setBusy(lessonSend, true, 'Kviečiama…');
        const result = await inviteNow(partner, duration);
        setBusy(lessonSend, false);
        if (!result.ok || !UUID_PATTERN.test(result.id || '')) {
          showBanner(lessonError, LESSON_ERRORS[result.error] || LESSON_ERRORS.failed);
          return;
        }
        lessonDialog.close();
        return;
      }
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
        : await lessonRpc(session, 'lesson_request', { p_partner: partner.id, p_starts_at: at.toISOString(), p_duration: duration });
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