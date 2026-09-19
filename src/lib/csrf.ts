/**
 * Double submit cookie, for the forms a signed-out visitor can post.
 *
 * The admin forms behind the guard are already covered by the session cookie
 * being SameSite=Lax: a cross-site POST does not carry it, so the request
 * arrives signed out and does nothing. Sign-in and registration are the
 * exceptions, because neither needs an existing session — a third-party page
 * can post to them and have something happen.
 *
 * On sign-in that is a phishing primitive: land the visitor in an account the
 * attacker controls and read whatever they type next. On registration it is
 * cheaper but still real — burning an invite code on the attacker's timing.
 *
 * The token is minted on GET, kept in a cookie and echoed in a hidden field.
 * Only a page on this origin can read the cookie back, so only a form this
 * site rendered can present a matching pair.
 *
 * WHY THE SCOPE IS A PARAMETER
 * ----------------------------
 * A cookie set with `path=/admin` is never sent to `/contact`, so a single
 * scope cannot protect both the sign-in form and a public enquiry form — the
 * public form would read back an empty cookie and reject every honest
 * submission. Widening the existing cookie to `/` would be the easy fix and
 * the wrong one: the admin token would then ride along on every public
 * request, including ones served to visitors who will never sign in.
 *
 * So each scope gets its own cookie at its own path. They are independent —
 * a token minted for the public form cannot satisfy the admin check, which is
 * the point.
 */

import type { AstroCookies } from 'astro';

/**
 * Where a form lives, which is also the cookie's path. Adding a scope means
 * adding a route that posts while signed out; there is no reason to invent one
 * otherwise.
 */
export type CsrfScope = '/admin' | '/contact' | '/check-in' | '/intake';

const COOKIES: Record<CsrfScope, string> = {
  '/admin': 'dj_form_csrf',
  '/contact': 'dj_public_csrf',
  '/check-in': 'dj_checkin_csrf',
  '/intake': 'dj_intake_csrf',
};

const SHAPE = /^[0-9a-f]{64}$/;

export function mintCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compared in constant time, so a near miss is not distinguishable by clock. */
export function tokensMatch(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Does the submitted field match the cookie this browser was given for this scope? */
export function csrfValid(
  cookies: AstroCookies,
  submitted: FormDataEntryValue | null,
  scope: CsrfScope,
): boolean {
  return tokensMatch(cookies.get(COOKIES[scope])?.value ?? '', String(submitted ?? ''));
}

/**
 * Token for the form about to be rendered, and the cookie that backs it.
 *
 * An existing token is reused rather than rotated: rotating on every render
 * invalidates the form in any other tab the visitor already has open, and the
 * value is unguessable either way.
 */
export function issueCsrfToken(cookies: AstroCookies, url: URL, scope: CsrfScope): string {
  const name = COOKIES[scope];
  const existing = cookies.get(name)?.value;
  const token = existing && SHAPE.test(existing) ? existing : mintCsrfToken();

  cookies.set(name, token, {
    path: scope,
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: 60 * 60,
  });

  return token;
}

/** Called once the form has served its purpose, so a stale one cannot be replayed. */
export function clearCsrfToken(cookies: AstroCookies, scope: CsrfScope): void {
  cookies.delete(COOKIES[scope], { path: scope });
}
