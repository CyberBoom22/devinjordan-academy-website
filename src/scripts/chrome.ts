/** Mobile drawer, the shrinking centre logo, and the loading screen. */

export function initMobileMenu(): void {
    const menu = document.getElementById('mobileMenu');
    const toggle = document.getElementById('navToggle');
    if (!menu || !toggle) return;

    toggle.addEventListener('click', () => {
        const open = menu.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
    });

    // Closing on navigation matters again now that routes are real pages: the
    // drawer would otherwise flash open during the next page's first paint.
    menu.querySelectorAll('a').forEach((a) => {
        a.addEventListener('click', () => {
            menu.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });
}

export function initLogoScroll(): void {
    const logo = document.getElementById('brandLogo');
    const nav = document.querySelector('nav');
    if (!logo || !nav) return;

    // The full-size logo is only ever shown at the top of the home page; every
    // other route starts compact, which `data-home` on <body> tells us.
    const isHome = document.body.dataset.home === 'true';

    const sync = () => {
        const compact = window.scrollY > 80 || !isHome;
        logo.classList.toggle('scrolled', compact);
        nav.classList.toggle('scrolled', compact);
    };

    window.addEventListener('scroll', sync, { passive: true });
    sync();
}

export function initPreloader(): void {
    const el = document.getElementById('preloader');
    if (!el) return;

    let hidden = false;
    const dismiss = () => {
        if (hidden) return;
        hidden = true;
        el.classList.add('is-done');
        el.setAttribute('aria-hidden', 'true');
        // Drop it from the layout once the fade has finished
        window.setTimeout(() => { el.style.display = 'none'; }, 700);
    };

    if (document.readyState === 'complete') {
        window.setTimeout(dismiss, 400);
    } else {
        window.addEventListener('load', () => window.setTimeout(dismiss, 400));
    }
    // Never hold the page hostage to a slow font or image
    window.setTimeout(dismiss, 5000);
}
