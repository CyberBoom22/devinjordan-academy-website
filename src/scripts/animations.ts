/**
 * Scroll reveal. Elements animate in when they enter the viewport and reset
 * when they leave, so the animation replays on the way back — including from
 * the top edge, which is what the `from-top` class distinguishes.
 */
const ANIM_SELECTOR =
    '.anim-snap-up, .anim-hard-left, .anim-hard-right, .anim-enter-up';

export function initScrollAnimations(): void {
    const elements = document.querySelectorAll<HTMLElement>(ANIM_SELECTOR);
    if (!elements.length) return;

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                const rect = entry.boundingClientRect;
                const target = entry.target as HTMLElement;
                if (entry.isIntersecting && (entry.intersectionRatio >= 0.1 || rect.top <= 0)) {
                    target.classList.add('is-visible');
                } else if (!entry.isIntersecting) {
                    target.classList.remove('is-visible');
                    target.classList.toggle('from-top', rect.top < 0);
                }
            });
        },
        { root: null, rootMargin: '0px', threshold: [0, 0.1] },
    );

    elements.forEach((el) => {
        // Hero copy is visible on arrival and must not animate in.
        if (el.closest('.hero')) return;
        el.classList.remove('is-visible');
        observer.observe(el);
    });

    revealInView();
}

/** Reveal anything already sitting in the viewport on first paint. */
export function revealInView(): void {
    document.querySelectorAll<HTMLElement>(ANIM_SELECTOR).forEach((el) => {
        const box = el.getBoundingClientRect();
        if (box.top < window.innerHeight * 0.92 && box.bottom > 0) {
            el.classList.add('is-visible');
        }
    });
}

export { ANIM_SELECTOR };
