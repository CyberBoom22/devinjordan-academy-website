/**
 * Session loading and the permission check the whole application uses.
 *
 * The permission set is resolved ONCE per request in middleware and handed to
 * templates through Astro.locals. Templates then call `can()`, which is a
 * synchronous set lookup — no template ever issues its own auth query, so a
 * page with thirty permission-gated buttons still costs one round trip.
 *
 * Note what this is NOT: it is not the security boundary. Hiding a button is a
 * courtesy to the user. The database refuses the write regardless, because
 * every table's RLS policy calls the same app.has_permission(). If these two
 * ever disagree, the database wins and the UI is simply out of date.
 */

import type { Client } from '../supabase/server';
import type { Permission } from './permissions';

export type SessionUser = {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  status: 'invited' | 'active' | 'suspended';
  /** Best (lowest) role level held. 999 means no role at all. */
  level: number;
  roles: { key: string; name: string; level: number }[];
};

export type Session = {
  user: SessionUser | null;
  permissions: ReadonlySet<string>;
};

export const EMPTY_SESSION: Session = { user: null, permissions: new Set() };

/**
 * Resolve the signed-in user, their roles and their effective permissions.
 *
 * Effective permissions mirror app.has_permission() exactly: per-user
 * overrides first (a deny beats every role), then the union of role
 * permissions. The logic lives in both places on purpose — the database copy
 * is the one that enforces, this copy is the one that renders.
 */
export async function loadSession(supabase: Client | null): Promise<Session> {
  if (!supabase) return EMPTY_SESSION;

  // getUser() revalidates the token with Supabase rather than trusting the
  // cookie's contents, which is the difference between a session check and a
  // forgeable claim.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return EMPTY_SESSION;

  const [profileResult, rolesResult, overridesResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, status')
      .eq('id', user.id)
      .single(),
    supabase
      .from('user_roles')
      .select('role:roles(id, key, name, level, role_permissions(permission_key))')
      .eq('user_id', user.id),
    supabase.from('user_permissions').select('permission_key, effect').eq('user_id', user.id),
  ]);

  const profile = profileResult.data;
  if (!profile || profile.status !== 'active') {
    // A suspended or not-yet-accepted account is treated as signed out for
    // every purpose except the message we show them.
    return {
      user: profile
        ? {
            id: profile.id,
            email: profile.email,
            fullName: profile.full_name,
            avatarUrl: profile.avatar_url,
            status: profile.status,
            level: 999,
            roles: [],
          }
        : null,
      permissions: new Set(),
    };
  }

  const roleRows = (rolesResult.data ?? [])
    .map((row: { role: unknown }) => row.role)
    .filter(Boolean) as {
    key: string;
    name: string;
    level: number;
    role_permissions: { permission_key: string }[];
  }[];

  const permissions = new Set<string>();
  for (const role of roleRows) {
    for (const rp of role.role_permissions ?? []) permissions.add(rp.permission_key);
  }

  // Overrides are applied last so a deny can strip something a role granted.
  for (const override of overridesResult.data ?? []) {
    if (override.effect === 'grant') permissions.add(override.permission_key);
    else permissions.delete(override.permission_key);
  }

  return {
    user: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      avatarUrl: profile.avatar_url,
      status: profile.status,
      level: roleRows.length ? Math.min(...roleRows.map((r) => r.level)) : 999,
      roles: roleRows.map(({ key, name, level }) => ({ key, name, level })),
    },
    permissions,
  };
}

/** Does this session hold the permission? */
export function can(session: Session, permission: Permission): boolean {
  return session.permissions.has(permission);
}

/** Does this session hold at least one of these permissions? */
export function canAny(session: Session, ...permissions: Permission[]): boolean {
  return permissions.some((permission) => session.permissions.has(permission));
}

/**
 * May this session administer an account at the given role level?
 * Mirrors app.can_manage_user(): strictly greater level, never a peer.
 */
export function outranks(session: Session, targetLevel: number): boolean {
  return session.user !== null && session.user.level < targetLevel;
}
