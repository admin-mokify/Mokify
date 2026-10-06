// Mokify — shared front-end behaviour (no build step, progressively enhanced)

document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();
  initPasswordToggles();
  initRoleSwitch();
  initSectionReveal();
  initTransparentHeader();
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
      btn.textContent = showing ? 'Rodyti' : 'Slėpti';
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

// Front-end-only form handling for the auth shell (no backend yet).
function handleShellForm(form, redirectUrl) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let valid = true;

    form.querySelectorAll('[required]').forEach((input) => {
      const field = input.closest('.field');
      if (!field) return;
      const ok = input.type === 'checkbox' ? input.checked : input.value.trim().length > 0;
      field.classList.toggle('has-error', !ok);
      if (!ok) valid = false;
    });

    if (!valid) {
      form.querySelector('.field.has-error input, .field.has-error select')?.focus();
      return;
    }

    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.dataset.originalText = submitBtn.textContent;
      submitBtn.textContent = 'Kraunama…';
    }

    window.setTimeout(() => {
      window.location.href = redirectUrl;
    }, 600);
  });
}
