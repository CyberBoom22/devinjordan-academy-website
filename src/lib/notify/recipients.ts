/**
 * Who gets told when the public form is submitted.
 *
 * SERVER ONLY. This module reads through the service role key, which bypasses
 * row level security. Importing it from anything that reaches the browser is a
 * bug, not a style preference.
 *
 * The list is derived from roles rather than configured, because the
 * alternative is an address list in wrangler.toml that goes stale the first
 * time someone joins or leaves and nobody remembers the deploy. Whoever holds
 * Owner or Instructor today is who answers enquiries today.
 *
 * Why the service role rather than a policy: the visitor submitting the form is
 * signed out, and `profiles` is readable only with `user.read`. Granting anon
 * any view of that table to send one email would publish the academy's staff
 * roster to anyone who could call the endpoint — the exact trade the RLS was
 * written to refuse. So the lookup happens server-side, where the addresses
 * never leave the Worker.
 *
 * Suspended and invited accounts are excluded. An address that cannot sign in
 * is an address that may no longer belong to the person it names.
 */

import { createAdminClient } from '../supabase/server';

/** Roles that answer enquiries. Owner first so the fallback order is sensible. */
const NOTIFIED_ROLES = ['owner', 'instructor'] as const;

export type RecipientLookup = {
  emails: string[];
  /**
   * Why the list is empty, when it is. The caller records this rather than
   * discarding it: "nobody holds the role" and "the database was unreachable"
   * need different fixes, and both look like silence in an inbox.
   */
  problem: string | null;
};

/**
 * Active owners and instructors, de-duplicated.
 *
 * Never throws. A contact form that 500s because the notification lookup
 * failed has turned a missing email into a lost enquiry, which is the worse
 * half of the trade.
 */
export async function getEnquiryRecipients(
  runtimeEnv?: Record<string, string | undefined>,
): Promise<RecipientLookup> {
  const admin = createAdminClient(runtimeEnv);
  if (!admin) {
    return { emails: [], problem: 'No service role key, so recipients could not be looked up.' };
  }

  try {
    // Two steps rather than one filtered join. Filtering on an embedded
    // resource silently returns rows with a null embed when it does not match
    // the way PostgREST expects, and an enquiry that quietly notifies nobody is
    // the failure this whole module exists to prevent. Resolving the role ids
    // first fails loudly instead.
    const { data: roleRows, error: roleError } = await admin
      .from('roles')
      .select('id')
      .in('key', [...NOTIFIED_ROLES]);

    if (roleError) return { emails: [], problem: roleError.message };

    const roleIds = (roleRows ?? []).map((role) => role.id);
    if (!roleIds.length) {
      return { emails: [], problem: 'Neither the owner nor the instructor role exists.' };
    }

    const { data, error } = await admin
      .from('user_roles')
      .select('profiles!inner(email, status)')
      .in('role_id', roleIds);

    if (error) return { emails: [], problem: error.message };

    const rows = (data ?? []) as unknown as {
      profiles: { email: string | null; status: string } | null;
    }[];

    const emails = [
      ...new Set(
        rows
          .map((row) => row.profiles)
          .filter((profile) => profile?.status === 'active')
          .map((profile) => profile?.email?.trim().toLowerCase())
          .filter((email): email is string => Boolean(email)),
      ),
    ];

    return {
      emails,
      problem: emails.length
        ? null
        : 'No active owner or instructor account has an email address on file.',
    };
  } catch (cause) {
    return { emails: [], problem: cause instanceof Error ? cause.message : String(cause) };
  }
}
