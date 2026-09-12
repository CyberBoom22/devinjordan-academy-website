/**
 * Header behaviour: the mobile menu, and the logo that shrinks on scroll.
 */

const nav = document.getElementById('siteNav');
const brandLogo = document.getElementById('brandLogo');
const navToggle = document.getElementById('navToggle');
const mobileMenu = document.getElementById('mobileMenu');

/* --- Mobile menu ---------------------------------------------------------- */
if (navToggle && mobileMenu) {
  navToggle.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });

  // Close on navigation, and on Escape.
  mobileMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => closeMenu());
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && mobileMenu.classList.contains('open')) {
      closeMenu();
      navToggle.focus();
    }
  });
}

function closeMenu(): void {
  mobileMenu?.classList.remove('open');
  navToggle?.setAttribute('aria-expanded', 'false');
  navToggle?.setAttribute('aria-label', 'Open menu');
}

export { closeMenu };

/* --- Shrink-on-scroll ----------------------------------------------------- */
if (nav && brandLogo) {
  // The logo starts compact on interior pages, where there is no hero for the
  // full-size mark to sit over.
  const isHome = window.location.pathname === '/' || window.location.pathname === '';

  const sync = () => {
    const compact = window.scrollY > 80 || !isHome;
    brandLogo.classList.toggle('scrolled', compact);
    nav.classList.toggle('scrolled', compact);
  };

  // Scroll fires far more often than the class actually needs to change;
  // coalescing into a frame keeps it off the main thread's critical path.
  let queued = false;
  window.addEventListener(
    'scroll',
    () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        sync();
      });
    },
    { passive: true },
  );

  sync();
}
