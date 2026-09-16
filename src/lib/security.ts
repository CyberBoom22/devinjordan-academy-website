/**
 * Security response headers.
 *
 * The previous build ran on GitHub Pages, which cannot set response headers at
 * all — so `frame-ancestors`, `X-Frame-Options`, `Permissions-Policy` and a
 * controllable HSTS were documented as known gaps, with a JavaScript framing
 * check standing in for the real thing. Running on Cloudflare removes that
 * limitation, and these are the headers that close it.
 *
 * The JavaScript clickjacking guard is no longer needed: `frame-ancestors
 * 'none'` is enforced by the browser before any of our script runs.
 */

import { getSupabaseConfig } from './supabase/env';

type Options = {
  /** Dev servers inject inline scripts and styles that production never has. */
  isDev: boolean;
  /** Admin pages must never be cached or indexed. */
  isAdmin: boolean;
  /**
   * Whether this response was rendered for a signed-in account. A public page
   * shown to one carries their name in the admin bar, and a shared cache that
   * kept it would hand that to the next visitor.
   */
  isAuthenticated: boolean;
  runtimeEnv?: Record<string, string | undefined>;
  isHttps: boolean;
};

export function applySecurityHeaders(headers: Headers, options: Options): void {
  const { isDev, isAdmin, isAuthenticated, runtimeEnv, isHttps } = options;

  // The admin area talks to Supabase directly from the browser, so its origin
  // has to be reachable. Nothing else is.
  const supabaseOrigin = getSupabaseConfig(runtimeEnv)?.url;
  const connectSrc = ["'self'", supabaseOrigin, supabaseOrigin?.replace(/^https:/, 'wss:')]
    .filter(Boolean)
    .join(' ');

  const directives = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    isDev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSrc}${isDev ? ' ws: http://localhost:* http://127.0.0.1:*' : ''}`,
    "object-src 'none'",
    "frame-src 'none'",
    // Only settable as a real header — this is the gap that GitHub Pages left open.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ];

  headers.set('Content-Security-Policy', directives.join('; '));
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  // The academy has no use for any of these, and switching them off means a
  // compromised script cannot quietly ask for them either.
  headers.set(
    'Permissions-Policy',
    [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', '),
  );

  // Only meaningful over HTTPS, and asserting it over plain HTTP in local
  // development would lock the developer's browser onto https://localhost.
  if (isHttps && !isDev) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Personalised but public: cacheable only by the one browser it belongs to.
  if (isAuthenticated && !isAdmin) {
    headers.set('Cache-Control', 'private, no-store');
  }

  if (isAdmin) {
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
}
