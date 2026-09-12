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
import { loadSession, EMPTY_SESSION } from './lib/auth/session';
import { applySecurityHeaders } from './lib/security';

/** Admin routes that a signed-out visitor is allowed to reach. */
const PUBLIC_ADMIN_PATHS = ['/admin/login', '/admin/forgot-password', '/admin/reset-password'];

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

    if (!permissions.has('admin.access')) {
      return context.redirect('/admin/login?error=no-access', 302);
    }
  }

  const response = await next();

  applySecurityHeaders(response.headers, {
    isDev: import.meta.env.DEV,
    isAdmin: isAdminRoute,
    isHttps: context.url.protocol === 'https:',
    runtimeEnv,
  });

  return response;
});
