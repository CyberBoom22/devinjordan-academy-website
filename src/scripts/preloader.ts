/**
 * Dismiss the loading screen.
 *
 * Three independent triggers, because the one failure mode that matters is a
 * loading screen that never goes away: the load event, a hard timeout, and a
 * CSS animation in the component itself. Any one of them is enough.
 */

const preloader = document.getElementById('preloader');

if (preloader) {
  let dismissed = false;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    preloader.classList.add('is-done');
    preloader.setAttribute('aria-hidden', 'true');
    // Drop it from the layout once the fade has finished.
    window.setTimeout(() => {
      preloader.style.display = 'none';
    }, 700);
  };

  if (document.readyState === 'complete') {
    window.setTimeout(dismiss, 400);
  } else {
    window.addEventListener('load', () => window.setTimeout(dismiss, 400));
  }

  // Never hold the page hostage to a slow font or image.
  window.setTimeout(dismiss, 5000);
}
