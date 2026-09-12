/**
 * Generates the roles + permissions seed migration from src/lib/permissions.ts.
 *
 * The catalogue is defined once, in TypeScript, so the app gets compile-time
 * checking of every permission key. This script emits the matching SQL, which
 * means the database can never hold a different set of permissions from the one
 * the code believes in — a class of bug that is otherwise very easy to create
 * and very unpleasant to debug.
 *
 *   node --experimental-strip-types scripts/generate-permission-seed.mjs
 */
import { writeFile } from 'node:fs/promises';

const { PERMISSIONS, PERMISSION_CATEGORIES, ROLES } = await import('../src/lib/permissions.ts');

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const OUT = 'supabase/migrations/0002_seed_roles_permissions.sql';

const lines = [];
lines.push('-- GENERATED FILE — do not edit by hand.');
lines.push('-- Source: src/lib/permissions.ts');
lines.push('-- Regenerate: node --experimental-strip-types scripts/generate-permission-seed.mjs');
lines.push('');
lines.push('begin;');
lines.push('');

lines.push('-- ---------- permission catalogue ----------');
lines.push('insert into public.permissions (key, category, label, description, sort_order) values');
lines.push(
    PERMISSIONS.map((p, i) =>
        `  (${q(p.key)}, ${q(p.category)}, ${q(p.label)}, ${q(p.description)}, ${i})`,
    ).join(',\n') + '\non conflict (key) do update set',
);
lines.push('  category = excluded.category,');
lines.push('  label = excluded.label,');
lines.push('  description = excluded.description,');
lines.push('  sort_order = excluded.sort_order;');
lines.push('');

lines.push('-- Remove permissions that no longer exist in the catalogue.');
lines.push(
    `delete from public.permissions where key not in (${PERMISSIONS.map((p) => q(p.key)).join(', ')});`,
);
lines.push('');

lines.push('-- ---------- roles ----------');
lines.push('insert into public.roles (id, label, description, is_superuser, is_system, sort_order) values');
lines.push(
    ROLES.map((r, i) =>
        `  (${q(r.id)}, ${q(r.label)}, ${q(r.description)}, ${r.isSuperuser}, true, ${i})`,
    ).join(',\n') + '\non conflict (id) do update set',
);
lines.push('  label = excluded.label,');
lines.push('  description = excluded.description,');
lines.push('  is_superuser = excluded.is_superuser,');
lines.push('  sort_order = excluded.sort_order;');
lines.push('');

lines.push('-- ---------- default grants per role ----------');
lines.push('-- Defaults only. The owner can grant or revoke individual permissions');
lines.push('-- per person from the dashboard; those live in user_permissions and are');
lines.push('-- never touched by this migration.');
for (const role of ROLES) {
    if (role.isSuperuser) {
        lines.push(`-- ${role.id}: superuser, holds every permission implicitly.`);
        continue;
    }
    lines.push(`delete from public.role_permissions where role_id = ${q(role.id)};`);
    if (role.defaults.length) {
        lines.push('insert into public.role_permissions (role_id, permission_key) values');
        lines.push(
            role.defaults.map((k) => `  (${q(role.id)}, ${q(k)})`).join(',\n') + ';',
        );
    }
    lines.push('');
}

lines.push('commit;');
lines.push('');

await writeFile(OUT, lines.join('\n'));
console.log(
    `${OUT}: ${PERMISSIONS.length} permissions across ${Object.keys(PERMISSION_CATEGORIES).length} categories, ${ROLES.length} roles`,
);
