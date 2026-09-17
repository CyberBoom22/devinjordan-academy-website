/**
 * Runs before every request.
 *
 * Two jobs: build the request-scoped Supabase client and resolve the visitor's
 * permissions once, then guard the admin area. Doing the guard here rather than
 * in each page means a new admin page is protected the moment it is created —
 * forgetting to add a check is not possible, because there is no check to add.
 */

import { defineMiddleware } from 'astro:middleware';
import { createRequestClient } from './lib/supabase/server';
import { loadSession, EMPTY_SESSION, sessionExpired } from './lib/auth/session';
import { applySecurityHeaders } from './lib/security';

/** Admin routes that a signed-out visitor is allowed to reach. */
const PUBLIC_ADMIN_PATHS = [
  '/admin/login',
  '/admin/register',
  '/admin/forgot-password',
  '/admin/reset-password',
];

/**
 * Reachable while signed in but before the second factor has been given.
 *
 * Two-factor is required, not offered, so an account that has authenticated
 * with a password and nothing else can reach exactly these: the two pages that
 * raise it to aal2, and the door out. Everything else in the admin area waits.
 */
const STEP_UP_PATHS = ['/admin/setup-2fa', '/admin/verify-2fa', '/admin/logout'];

export const onRequest = defineMiddleware(async (context, next) => {
  const runtimeEnv = context.locals.runtime?.env as Record<string, string | undefined> | undefined;

  const supabase = createRequestClient({
    request: context.request,
    cookies: context.cookies,
    runtimeEnv,
  });

  context.locals.supabase = supabase;
  context.locals.session = supabase ? await loadSession(supabase) : EMPTY_SESSION;

  const path = context.url.pathname;
  const isAdminRoute = path === '/admin' || path.startsWith('/admin/');
  const isPublicAdminRoute = PUBLIC_ADMIN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  const isStepUpRoute = STEP_UP_PATHS.some((p) => path === p);

  if (isAdminRoute && !isPublicAdminRoute) {
    const { user, permissions } = context.locals.session;

    if (!user) {
      // Remember where they were headed so the login form can send them back.
      const redirectTo = encodeURIComponent(path + context.url.search);
      return context.redirect(`/admin/login?next=${redirectTo}`, 302);
    }

    if (user.status === 'suspended') {
      return context.redirect('/admin/login?error=suspended', 302);
    }

    // Age before authority. Supabase rotates refresh tokens indefinitely, so a
    // session left alone never ends on its own — and the realistic threat to an
    // admin area that can suspend accounts and mint invites is not a stolen
    // token, it is a laptop left unlocked. Checked on the way in rather than
    // trusted to a background job, so an expired session cannot serve even one
    // more page.
    if (sessionExpired(context.locals.session)) {
      await supabase?.auth.signOut();
      return context.redirect('/admin/login?error=expired', 302);
    }

    if (!permissions.has('admin.access')) {
      return context.redirect('/admin/login?error=no-access', 302);
    }

    // Who they are and what they may do are settled. What is left is how
    // strongly they proved it.
    if (!isStepUpRoute && supabase) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (!aal) {
        // Could not tell. Refusing is the wrong failure for a required check
        // with no way back, and letting them through defeats the point of
        // requiring it — so send them to the page that works the answer out
        // for itself and routes accordingly.
        return context.redirect('/admin/verify-2fa', 302);
      }

      // nextLevel is aal2 exactly when a verified factor exists.
      if (aal.nextLevel !== 'aal2') {
        return context.redirect('/admin/setup-2fa', 302);
      }

      if (aal.currentLevel !== 'aal2') {
        const redirectTo = encodeURIComponent(path + context.url.search);
        return context.redirect(`/admin/verify-2fa?next=${redirectTo}`, 302);
      }
    }
  }

  const response = await next();

  applySecurityHeaders(response.headers, {
    isDev: import.meta.env.DEV,
    isAdmin: isAdminRoute,
    isAuthenticated: context.locals.session.user !== null,
    isHttps: context.url.protocol === 'https:',
    runtimeEnv,
  });

  return response;
});
