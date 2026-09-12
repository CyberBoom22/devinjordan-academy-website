/**
 * Site entry point. Loaded once from BaseLayout with Astro's default module
 * bundling, which means it is served as a hashed, self-hosted file — no inline
 * script, so the Content Security Policy needs no 'unsafe-inline'.
 */
import { enforceTopLevel } from './guard';
import { initMobileMenu, initLogoScroll, initPreloader } from './chrome';
import { initScrollAnimations } from './animations';
import { initFind } from './find';
import { initOriDirectory } from './ori-directory';
import { initNewsBoard } from './news-board';

enforceTopLevel();

function boot(): void {
    initMobileMenu();
    initLogoScroll();
    initScrollAnimations();
    initFind();
    initOriDirectory();
    initNewsBoard();
    initPreloader();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
