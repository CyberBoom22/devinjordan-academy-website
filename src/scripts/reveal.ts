/**
 * Scroll-reveal animations.
 *
 * An element that scrolls out of view has its class removed so the animation
 * replays on the way back, and is tagged .from-top when it left through the
 * top edge so it returns from the direction the reader pushed it.
 *
 * Respects prefers-reduced-motion by not observing at all: the CSS already
 * shows everything under that query, so there is nothing to animate.
 */

const SELECTOR = '.anim-snap-up, .anim-hard-left, .anim-hard-right, .anim-enter-up';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const rect = entry.boundingClientRect;

        if (entry.isIntersecting && (entry.intersectionRatio >= 0.1 || rect.top <= 0)) {
          entry.target.classList.add('is-visible');
        } else if (!entry.isIntersecting) {
          entry.target.classList.remove('is-visible');
          entry.target.classList.toggle('from-top', rect.top < 0);
        }
      }
    },
    { root: null, rootMargin: '0px', threshold: [0, 0.1] },
  );

  document.querySelectorAll(SELECTOR).forEach((element) => {
    // Anything already marked visible on the server (the hero) is left alone.
    if (element.classList.contains('is-visible')) return;
    observer.observe(element);
  });
} else {
  // No observer support: show everything rather than hide it.
  document.querySelectorAll(SELECTOR).forEach((element) => element.classList.add('is-visible'));
}

/**
 * Reveal anything already in the viewport without waiting for a scroll.
 * Exported so the find bar can call it after jumping to a match.
 */
export function revealInView(): void {
  document.querySelectorAll(SELECTOR).forEach((element) => {
    const box = element.getBoundingClientRect();
    if (box.top < window.innerHeight * 0.92 && box.bottom > 0) {
      element.classList.add('is-visible');
    }
  });
}
