/**
 * Generate the SQL that seeds roles and permissions from the TypeScript
 * registry, so the two cannot drift apart.
 *
 *   npm run db:permissions          # print to stdout
 *   npm run db:permissions -- --write  # overwrite the migration
 *
 * The output is idempotent: every statement is an upsert, and permissions that
 * no longer exist in the registry are deleted. Running it against a live
 * database after adding a permission is safe and is the intended workflow.
 *
 * Role permissions are only seeded for roles that still carry their defaults.
 * Once the academy edits a role in the admin UI, regenerating must not quietly
 * undo their choices — so this writes role_permissions only for roles with no
 * rows at all.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(here, '..', 'supabase', 'migrations', '0003_seed_roles.sql');

const { ROLES, PERMISSIONS, PERMISSION_KEYS, defaultPermissionsFor } =
  await import('../src/lib/auth/permissions.ts');

const quote = (value) =>
  value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`;

const lines = [];

lines.push('-- ===========================================================================');
lines.push('-- 0003 — Seed roles and permissions');
lines.push('--');
lines.push('-- GENERATED FILE. Do not edit by hand.');
lines.push('-- Source: src/lib/auth/permissions.ts');
lines.push('-- Regenerate: npm run db:permissions -- --write');
lines.push('--');
lines.push('-- Safe to re-run: every statement is an upsert. Role permissions are only');
lines.push('-- written for roles that have none yet, so re-running never undoes a change');
lines.push('-- the academy made in the admin UI.');
lines.push('-- ===========================================================================');
lines.push('');

lines.push('-- --- Roles ----------------------------------------------------------------');
lines.push('insert into public.roles (key, name, description, level, is_system) values');
const roleValues = Object.entries(ROLES).map(
  ([key, role]) =>
    `  (${quote(key)}, ${quote(role.name)}, ${quote(role.description)}, ${role.level}, true)`,
);
lines.push(roleValues.join(',\n'));
lines.push('on conflict (key) do update set');
lines.push('  name = excluded.name,');
lines.push('  description = excluded.description,');
lines.push("  -- level is intentionally NOT updated: changing a live role's authority");
lines.push('  -- rank would silently re-order who can administer whom.');
lines.push('  is_system = excluded.is_system;');
lines.push('');

lines.push('-- --- Permissions ----------------------------------------------------------');
lines.push('insert into public.permissions (key, label, "group", description) values');
const permValues = PERMISSION_KEYS.map((key) => {
  const perm = PERMISSIONS[key];
  return `  (${quote(key)}, ${quote(perm.label)}, ${quote(perm.group)}, ${quote(perm.description)})`;
});
lines.push(permValues.join(',\n'));
lines.push('on conflict (key) do update set');
lines.push('  label = excluded.label,');
lines.push('  "group" = excluded."group",');
lines.push('  description = excluded.description;');
lines.push('');

lines.push('-- Drop permissions that no longer exist in the registry. The cascade on');
lines.push('-- role_permissions and user_permissions clears the references.');
lines.push('delete from public.permissions where key not in (');
lines.push(PERMISSION_KEYS.map((key) => `  ${quote(key)}`).join(',\n'));
lines.push(');');
lines.push('');

lines.push('-- --- Default role permissions ---------------------------------------------');
lines.push('-- Only applied to roles that currently hold none, so an edited role keeps');
lines.push('-- whatever the academy chose.');
for (const [roleKey] of Object.entries(ROLES)) {
  const permissions = defaultPermissionsFor(roleKey);
  lines.push('');
  lines.push(`-- ${ROLES[roleKey].name}: ${permissions.length} permissions`);
  lines.push('insert into public.role_permissions (role_id, permission_key)');
  lines.push('select r.id, p.key');
  lines.push('from public.roles r');
  lines.push('cross join public.permissions p');
  lines.push(`where r.key = ${quote(roleKey)}`);
  lines.push(`  and p.key in (${permissions.map(quote).join(', ')})`);
  lines.push('  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id)');
  lines.push('on conflict do nothing;');
}
lines.push('');

const sql = lines.join('\n');

if (process.argv.includes('--write')) {
  writeFileSync(OUTPUT, sql);
  const existing = readFileSync(OUTPUT, 'utf8');
  console.error(`Wrote ${OUTPUT} (${existing.split('\n').length} lines)`);
} else {
  process.stdout.write(sql);
}
