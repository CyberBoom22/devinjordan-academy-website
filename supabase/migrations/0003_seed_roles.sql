-- ===========================================================================
-- 0003 — Seed roles and permissions
--
-- GENERATED FILE. Do not edit by hand.
-- Source: src/lib/auth/permissions.ts
-- Regenerate: npm run db:permissions -- --write
--
-- Safe to re-run: every statement is an upsert. Role permissions are only
-- written for roles that have none yet, so re-running never undoes a change
-- the academy made in the admin UI.
-- ===========================================================================

-- --- Roles ----------------------------------------------------------------
insert into public.roles (key, name, description, level, is_system) values
  ('owner', 'Owner', 'The academy. Unrestricted access, including billing, site settings and the ability to manage administrators. There is always at least one owner and the last one cannot be removed.', 10, true),
  ('admin', 'Administrator', 'Runs the site day to day: all content, all media, and user management for everyone below administrator level.', 20, true),
  ('editor', 'Editor', 'Creates and publishes every kind of content — pages, courses, instructor bios, news and the ORI directory. No access to users or settings.', 30, true),
  ('instructor', 'Instructor', 'Maintains their own instructor profile and can draft news items for an editor to publish. Cannot change anyone else’s content.', 40, true),
  ('viewer', 'Viewer', 'Read-only access to the admin area and to course enquiries. Intended for bookkeepers and anyone who needs to see but never change.', 50, true)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  -- level is intentionally NOT updated: changing a live role's authority
  -- rank would silently re-order who can administer whom.
  is_system = excluded.is_system;

-- --- Permissions ----------------------------------------------------------
insert into public.permissions (key, label, "group", description) values
  ('admin.access', 'Sign in to the admin area', 'Admin area', 'Without this, an account can sign in but sees nothing to manage. Every other permission depends on it.'),
  ('page.read', 'View pages', 'Pages', 'See page content in the admin area, including unpublished drafts.'),
  ('page.write', 'Edit pages', 'Pages', 'Change the wording of the Home, About, News and ORI pages. Changes stay as drafts until published.'),
  ('page.publish', 'Publish pages', 'Pages', 'Make page edits visible to the public. Separate from editing so drafts can be reviewed first.'),
  ('course.read', 'View courses', 'Courses & tuition', 'See the course list and pricing in the admin area.'),
  ('course.write', 'Add and edit courses', 'Courses & tuition', 'Create courses, change descriptions, and set tuition prices.'),
  ('course.publish', 'Publish courses', 'Courses & tuition', 'Show or hide a course on the public Services page.'),
  ('course.delete', 'Delete courses', 'Courses & tuition', 'Permanently remove a course. Prefer unpublishing — deletion cannot be undone.'),
  ('instructor.read', 'View instructor profiles', 'Instructors', 'See every instructor bio, including unpublished ones.'),
  ('instructor.write', 'Edit any instructor profile', 'Instructors', 'Change any instructor’s bio, photo and service record.'),
  ('instructor.write.self', 'Edit own instructor profile', 'Instructors', 'Edit only the profile linked to this account. This is what lets an instructor keep their own bio current without being able to touch anyone else’s.'),
  ('instructor.publish', 'Publish instructor profiles', 'Instructors', 'Show or hide an instructor on the public About page.'),
  ('news.read', 'View news items', 'News & legislation', 'See tracked bills and court decisions, including drafts.'),
  ('news.write', 'Write news items', 'News & legislation', 'Draft and edit legislation summaries and court case notes.'),
  ('news.publish', 'Publish news items', 'News & legislation', 'Make a legislation summary public. Deliberately separate from writing: these summaries carry legal weight for students, so a second pair of eyes is the point.'),
  ('news.delete', 'Delete news items', 'News & legislation', 'Permanently remove a tracked bill or case.'),
  ('ori.read', 'View the ORI directory', 'ORI directory', 'See every agency and its ORI codes in the admin area.'),
  ('ori.write', 'Edit the ORI directory', 'ORI directory', 'Add, rename or retire agencies and correct ORI codes. These codes route real background checks, so this is restricted on purpose.'),
  ('media.read', 'Browse the media library', 'Media', 'See uploaded logos, photographs and documents.'),
  ('media.upload', 'Upload media', 'Media', 'Add images and documents for use in content.'),
  ('media.delete', 'Delete media', 'Media', 'Permanently remove a file. Anything still referenced by a page will break.'),
  ('enquiry.read', 'Read course enquiries', 'Enquiries', 'See messages submitted through the contact form, including names and phone numbers.'),
  ('enquiry.write', 'Manage course enquiries', 'Enquiries', 'Mark enquiries as handled, add internal notes, and archive them.'),
  ('user.read', 'View staff accounts', 'Users & roles', 'See who has access to the admin area and what they can do.'),
  ('user.invite', 'Invite staff', 'Users & roles', 'Send an email invitation to a new staff account.'),
  ('user.manage', 'Manage staff accounts', 'Users & roles', 'Change someone’s roles and per-person permissions, or suspend their access. Only ever applies to accounts BELOW your own role level — nobody can edit a peer or promote themselves.'),
  ('role.manage', 'Create and edit roles', 'Users & roles', 'Define new roles and choose exactly which permissions each one carries. The most powerful permission in the system — it can redefine what every other account is allowed to do.'),
  ('settings.read', 'View site settings', 'Settings', 'See contact details, addresses and site-wide options.'),
  ('settings.write', 'Change site settings', 'Settings', 'Update the phone numbers, address and other details shown across every page and in the footer.'),
  ('audit.read', 'Read the audit log', 'Settings', 'See a record of who changed what and when. Cannot be edited or cleared by anyone.')
on conflict (key) do update set
  label = excluded.label,
  "group" = excluded."group",
  description = excluded.description;

-- Drop permissions that no longer exist in the registry. The cascade on
-- role_permissions and user_permissions clears the references.
delete from public.permissions where key not in (
  'admin.access',
  'page.read',
  'page.write',
  'page.publish',
  'course.read',
  'course.write',
  'course.publish',
  'course.delete',
  'instructor.read',
  'instructor.write',
  'instructor.write.self',
  'instructor.publish',
  'news.read',
  'news.write',
  'news.publish',
  'news.delete',
  'ori.read',
  'ori.write',
  'media.read',
  'media.upload',
  'media.delete',
  'enquiry.read',
  'enquiry.write',
  'user.read',
  'user.invite',
  'user.manage',
  'role.manage',
  'settings.read',
  'settings.write',
  'audit.read'
);

-- --- Default role permissions ---------------------------------------------
-- Only applied to roles that currently hold none, so an edited role keeps
-- whatever the academy chose.

-- Owner: 30 permissions
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.key = 'owner'
  and p.key in ('admin.access', 'page.read', 'page.write', 'page.publish', 'course.read', 'course.write', 'course.publish', 'course.delete', 'instructor.read', 'instructor.write', 'instructor.write.self', 'instructor.publish', 'news.read', 'news.write', 'news.publish', 'news.delete', 'ori.read', 'ori.write', 'media.read', 'media.upload', 'media.delete', 'enquiry.read', 'enquiry.write', 'user.read', 'user.invite', 'user.manage', 'role.manage', 'settings.read', 'settings.write', 'audit.read')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id)
on conflict do nothing;

-- Administrator: 29 permissions
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.key = 'admin'
  and p.key in ('admin.access', 'page.read', 'page.write', 'page.publish', 'course.read', 'course.write', 'course.publish', 'course.delete', 'instructor.read', 'instructor.write', 'instructor.write.self', 'instructor.publish', 'news.read', 'news.write', 'news.publish', 'news.delete', 'ori.read', 'ori.write', 'media.read', 'media.upload', 'media.delete', 'enquiry.read', 'enquiry.write', 'user.read', 'user.invite', 'user.manage', 'settings.read', 'settings.write', 'audit.read')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id)
on conflict do nothing;

-- Editor: 22 permissions
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.key = 'editor'
  and p.key in ('admin.access', 'page.read', 'page.write', 'page.publish', 'course.read', 'course.write', 'course.publish', 'instructor.read', 'instructor.write', 'instructor.write.self', 'instructor.publish', 'news.read', 'news.write', 'news.publish', 'ori.read', 'ori.write', 'media.read', 'media.upload', 'media.delete', 'enquiry.read', 'enquiry.write', 'settings.read')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id)
on conflict do nothing;

-- Instructor: 12 permissions
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.key = 'instructor'
  and p.key in ('admin.access', 'page.read', 'course.read', 'instructor.read', 'instructor.write.self', 'news.read', 'news.write', 'ori.read', 'media.read', 'media.upload', 'enquiry.read', 'settings.read')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id)
on conflict do nothing;

-- Viewer: 9 permissions
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.key = 'viewer'
  and p.key in ('admin.access', 'page.read', 'course.read', 'instructor.read', 'news.read', 'ori.read', 'media.read', 'enquiry.read', 'settings.read')
  and not exists (select 1 from public.role_permissions rp where rp.role_id = r.id)
on conflict do nothing;
