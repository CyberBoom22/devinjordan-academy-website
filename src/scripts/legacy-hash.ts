/**
 * Redirect the old hash routes to real URLs.
 *
 * The previous build was a single document with a #/about style router, and
 * those links are in the wild — in the Wix embed, in anything anyone has
 * bookmarked or shared. They would otherwise all land on the homepage with a
 * fragment that means nothing, which looks like a broken link.
 *
 * Safe to delete once the old links have aged out; harmless until then.
 */

const LEGACY_ROUTES: Record<string, string> = {
  '#/home': '/',
  '#/about': '/about',
  '#/news': '/news',
  '#/ori': '/ori',
  '#/services': '/#services',
  '#/contact': '/#contact',
};

function handleLegacyHash(): void {
  const target = LEGACY_ROUTES[window.location.hash];
  if (!target) return;

  // replace() rather than assign() so the broken URL does not sit in the
  // visitor's back history waiting to be returned to.
  window.location.replace(target);
}

handleLegacyHash();
window.addEventListener('hashchange', handleLegacyHash);
