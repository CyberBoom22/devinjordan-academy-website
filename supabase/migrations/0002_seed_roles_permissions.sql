-- GENERATED FILE — do not edit by hand.
-- Source: src/lib/permissions.ts
-- Regenerate: node --experimental-strip-types scripts/generate-permission-seed.mjs

begin;

-- ---------- permission catalogue ----------
insert into public.permissions (key, category, label, description, sort_order) values
  ('content.site.read', 'content', 'View site settings', 'See contact details, address and academy information in the dashboard.', 0),
  ('content.site.write', 'content', 'Edit site settings', 'Change phone numbers, address and academy information shown on the site.', 1),
  ('content.courses.read', 'content', 'View courses', 'See the course list and tuition in the dashboard.', 2),
  ('content.courses.write', 'content', 'Edit courses and prices', 'Add, change or remove courses and their tuition. Affects what visitors are quoted.', 3),
  ('content.news.read', 'content', 'View news entries', 'See published and draft legislation entries.', 4),
  ('content.news.write', 'content', 'Write news entries', 'Create and edit legislation entries. Drafts are not visible to the public.', 5),
  ('content.news.publish', 'content', 'Publish news entries', 'Make a legislation entry live on the public site, or take one down.', 6),
  ('content.ori.read', 'content', 'View ORI directory', 'See the ORI agency directory in the dashboard.', 7),
  ('content.ori.write', 'content', 'Edit ORI directory', 'Add, correct or retire agency ORI codes. These are used to file real paperwork.', 8),
  ('media.upload', 'content', 'Upload images', 'Add photographs and logos to the media library.', 9),
  ('media.delete', 'content', 'Delete images', 'Permanently remove files from the media library.', 10),
  ('users.read', 'people', 'View people', 'See the list of accounts and which role each one holds.', 11),
  ('users.invite', 'people', 'Invite people', 'Send an invitation for a new account.', 12),
  ('users.update', 'people', 'Edit people', 'Change someone''s name and contact details. Does not include changing their role.', 13),
  ('users.deactivate', 'people', 'Deactivate people', 'Switch an account off so it can no longer sign in. Nothing is deleted.', 14),
  ('roles.manage', 'people', 'Assign roles', 'Change which role someone holds. A powerful permission — it changes what they can do.', 15),
  ('permissions.manage', 'people', 'Grant individual permissions', 'Grant or revoke single permissions for a person, on top of their role. Nobody can grant a permission they do not themselves hold.', 16),
  ('settings.manage', 'system', 'Manage system settings', 'Change technical configuration for the site.', 17),
  ('audit.read', 'system', 'Read the audit log', 'See the record of who changed what and when.', 18),
  ('deploy.trigger', 'system', 'Trigger a rebuild', 'Republish the public site without waiting for the next scheduled build.', 19)
on conflict (key) do update set
  category = excluded.category,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- Remove permissions that no longer exist in the catalogue.
delete from public.permissions where key not in ('content.site.read', 'content.site.write', 'content.courses.read', 'content.courses.write', 'content.news.read', 'content.news.write', 'content.news.publish', 'content.ori.read', 'content.ori.write', 'media.upload', 'media.delete', 'users.read', 'users.invite', 'users.update', 'users.deactivate', 'roles.manage', 'permissions.manage', 'settings.manage', 'audit.read', 'deploy.trigger');

-- ---------- roles ----------
insert into public.roles (id, label, description, is_superuser, is_system, sort_order) values
  ('owner', 'Owner', 'Full control, including granting and revoking permissions for everyone else. There must always be at least one active owner.', true, true, 0),
  ('instructor', 'Instructor', 'Teaches courses. Keeps the legislation tracker and the ORI directory current; can see tuition but not change it.', false, true, 1),
  ('staff', 'Staff', 'Front-office. Keeps contact details accurate and can see everything else without changing it.', false, true, 2),
  ('tech', 'Tech', 'Technical maintenance. Can configure and republish the site and read the audit log, but does not edit content or manage people by default.', false, true, 3)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  is_superuser = excluded.is_superuser,
  sort_order = excluded.sort_order;

-- ---------- default grants per role ----------
-- Defaults only. The owner can grant or revoke individual permissions
-- per person from the dashboard; those live in user_permissions and are
-- never touched by this migration.
-- owner: superuser, holds every permission implicitly.
delete from public.role_permissions where role_id = 'instructor';
insert into public.role_permissions (role_id, permission_key) values
  ('instructor', 'content.site.read'),
  ('instructor', 'content.courses.read'),
  ('instructor', 'content.news.read'),
  ('instructor', 'content.news.write'),
  ('instructor', 'content.news.publish'),
  ('instructor', 'content.ori.read'),
  ('instructor', 'content.ori.write'),
  ('instructor', 'media.upload');

delete from public.role_permissions where role_id = 'staff';
insert into public.role_permissions (role_id, permission_key) values
  ('staff', 'content.site.read'),
  ('staff', 'content.site.write'),
  ('staff', 'content.courses.read'),
  ('staff', 'content.news.read'),
  ('staff', 'content.ori.read'),
  ('staff', 'media.upload');

delete from public.role_permissions where role_id = 'tech';
insert into public.role_permissions (role_id, permission_key) values
  ('tech', 'content.site.read'),
  ('tech', 'content.courses.read'),
  ('tech', 'content.news.read'),
  ('tech', 'content.ori.read'),
  ('tech', 'users.read'),
  ('tech', 'settings.manage'),
  ('tech', 'audit.read'),
  ('tech', 'deploy.trigger');

commit;
