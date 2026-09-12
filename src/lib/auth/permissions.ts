/**
 * Permission registry — the canonical list of every action the system can
 * authorise, and the roles that hold each one by default.
 *
 * This file is the SOURCE OF TRUTH. The database is seeded from it via
 * `npm run db:permissions` (scripts/generate-permission-sql.mjs), which prints
 * SQL that keeps `permissions` and `role_permissions` in step with this list.
 *
 * WHY A REGISTRY INSTEAD OF ROLE CHECKS
 * -------------------------------------
 * Code never asks "is this user an admin?". It asks "may this user publish
 * news?". That means the client can invent a new role ("Front Desk", "Range
 * Officer") in the admin UI, tick the exact boxes it needs, and every existing
 * page honours it immediately — with no code change and no deploy. Role checks
 * scattered through templates would make that impossible.
 *
 * Per-user overrides sit on top of roles: a single instructor can be granted
 * `news.publish` without being promoted to Editor, and a compromised account
 * can have one permission denied without stripping its role.
 */

/* -------------------------------------------------------------------------
 * Roles
 * ---------------------------------------------------------------------- */

/**
 * Role levels form the hierarchy. LOWER NUMBER = MORE AUTHORITY.
 *
 * The level governs one thing that permissions deliberately cannot express:
 * who may administer whom. A user can only assign, edit or remove roles at a
 * level strictly BELOW their own. So an Admin (20) can manage Editors (30) and
 * Instructors (40), but can never modify the Owner (10) or another Admin — and
 * cannot promote themselves. Without this rule, any account holding
 * `users.manage` could escalate itself to full control.
 */
export const ROLES = {
  owner: {
    level: 10,
    name: 'Owner',
    description:
      'The academy. Unrestricted access, including billing, site settings and the ability to manage administrators. There is always at least one owner and the last one cannot be removed.',
  },
  admin: {
    level: 20,
    name: 'Administrator',
    description:
      'Runs the site day to day: all content, all media, and user management for everyone below administrator level.',
  },
  editor: {
    level: 30,
    name: 'Editor',
    description:
      'Creates and publishes every kind of content — pages, courses, instructor bios, news and the ORI directory. No access to users or settings.',
  },
  instructor: {
    level: 40,
    name: 'Instructor',
    description:
      'Maintains their own instructor profile and can draft news items for an editor to publish. Cannot change anyone else’s content.',
  },
  viewer: {
    level: 50,
    name: 'Viewer',
    description:
      'Read-only access to the admin area and to course enquiries. Intended for bookkeepers and anyone who needs to see but never change.',
  },
} as const;

export type RoleKey = keyof typeof ROLES;

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

/* -------------------------------------------------------------------------
 * Permissions
 * ---------------------------------------------------------------------- */

type PermissionDef = {
  /** Human label shown beside the checkbox in the admin role editor. */
  label: string;
  /** Group heading the checkbox sits under. */
  group: string;
  /** Plain-language consequence, shown as help text. */
  description: string;
  /** Roles that hold this permission on a fresh install. */
  defaultRoles: readonly RoleKey[];
};

const ALL_STAFF = ['owner', 'admin', 'editor', 'instructor', 'viewer'] as const;
const CONTENT_STAFF = ['owner', 'admin', 'editor'] as const;
const ADMINS = ['owner', 'admin'] as const;

export const PERMISSIONS = {
  /* --- Admin area -------------------------------------------------------- */
  'admin.access': {
    label: 'Sign in to the admin area',
    group: 'Admin area',
    description:
      'Without this, an account can sign in but sees nothing to manage. Every other permission depends on it.',
    defaultRoles: ALL_STAFF,
  },

  /* --- Pages ------------------------------------------------------------- */
  'page.read': {
    label: 'View pages',
    group: 'Pages',
    description: 'See page content in the admin area, including unpublished drafts.',
    defaultRoles: ALL_STAFF,
  },
  'page.write': {
    label: 'Edit pages',
    group: 'Pages',
    description:
      'Change the wording of the Home, About, News and ORI pages. Changes stay as drafts until published.',
    defaultRoles: CONTENT_STAFF,
  },
  'page.publish': {
    label: 'Publish pages',
    group: 'Pages',
    description:
      'Make page edits visible to the public. Separate from editing so drafts can be reviewed first.',
    defaultRoles: CONTENT_STAFF,
  },

  /* --- Courses ----------------------------------------------------------- */
  'course.read': {
    label: 'View courses',
    group: 'Courses & tuition',
    description: 'See the course list and pricing in the admin area.',
    defaultRoles: ALL_STAFF,
  },
  'course.write': {
    label: 'Add and edit courses',
    group: 'Courses & tuition',
    description: 'Create courses, change descriptions, and set tuition prices.',
    defaultRoles: CONTENT_STAFF,
  },
  'course.publish': {
    label: 'Publish courses',
    group: 'Courses & tuition',
    description: 'Show or hide a course on the public Services page.',
    defaultRoles: CONTENT_STAFF,
  },
  'course.delete': {
    label: 'Delete courses',
    group: 'Courses & tuition',
    description: 'Permanently remove a course. Prefer unpublishing — deletion cannot be undone.',
    defaultRoles: ADMINS,
  },

  /* --- Instructors ------------------------------------------------------- */
  'instructor.read': {
    label: 'View instructor profiles',
    group: 'Instructors',
    description: 'See every instructor bio, including unpublished ones.',
    defaultRoles: ALL_STAFF,
  },
  'instructor.write': {
    label: 'Edit any instructor profile',
    group: 'Instructors',
    description: 'Change any instructor’s bio, photo and service record.',
    defaultRoles: CONTENT_STAFF,
  },
  'instructor.write.self': {
    label: 'Edit own instructor profile',
    group: 'Instructors',
    description:
      'Edit only the profile linked to this account. This is what lets an instructor keep their own bio current without being able to touch anyone else’s.',
    defaultRoles: ['owner', 'admin', 'editor', 'instructor'],
  },
  'instructor.publish': {
    label: 'Publish instructor profiles',
    group: 'Instructors',
    description: 'Show or hide an instructor on the public About page.',
    defaultRoles: CONTENT_STAFF,
  },

  /* --- News & legislation ------------------------------------------------ */
  'news.read': {
    label: 'View news items',
    group: 'News & legislation',
    description: 'See tracked bills and court decisions, including drafts.',
    defaultRoles: ALL_STAFF,
  },
  'news.write': {
    label: 'Write news items',
    group: 'News & legislation',
    description: 'Draft and edit legislation summaries and court case notes.',
    defaultRoles: ['owner', 'admin', 'editor', 'instructor'],
  },
  'news.publish': {
    label: 'Publish news items',
    group: 'News & legislation',
    description:
      'Make a legislation summary public. Deliberately separate from writing: these summaries carry legal weight for students, so a second pair of eyes is the point.',
    defaultRoles: CONTENT_STAFF,
  },
  'news.delete': {
    label: 'Delete news items',
    group: 'News & legislation',
    description: 'Permanently remove a tracked bill or case.',
    defaultRoles: ADMINS,
  },

  /* --- ORI directory ----------------------------------------------------- */
  'ori.read': {
    label: 'View the ORI directory',
    group: 'ORI directory',
    description: 'See every agency and its ORI codes in the admin area.',
    defaultRoles: ALL_STAFF,
  },
  'ori.write': {
    label: 'Edit the ORI directory',
    group: 'ORI directory',
    description:
      'Add, rename or retire agencies and correct ORI codes. These codes route real background checks, so this is restricted on purpose.',
    defaultRoles: CONTENT_STAFF,
  },

  /* --- Media ------------------------------------------------------------- */
  'media.read': {
    label: 'Browse the media library',
    group: 'Media',
    description: 'See uploaded logos, photographs and documents.',
    defaultRoles: ALL_STAFF,
  },
  'media.upload': {
    label: 'Upload media',
    group: 'Media',
    description: 'Add images and documents for use in content.',
    defaultRoles: ['owner', 'admin', 'editor', 'instructor'],
  },
  'media.delete': {
    label: 'Delete media',
    group: 'Media',
    description: 'Permanently remove a file. Anything still referenced by a page will break.',
    defaultRoles: CONTENT_STAFF,
  },

  /* --- Enquiries --------------------------------------------------------- */
  'enquiry.read': {
    label: 'Read course enquiries',
    group: 'Enquiries',
    description:
      'See messages submitted through the contact form, including names and phone numbers.',
    defaultRoles: ALL_STAFF,
  },
  'enquiry.write': {
    label: 'Manage course enquiries',
    group: 'Enquiries',
    description: 'Mark enquiries as handled, add internal notes, and archive them.',
    defaultRoles: ['owner', 'admin', 'editor'],
  },

  /* --- Users & roles ----------------------------------------------------- */
  'user.read': {
    label: 'View staff accounts',
    group: 'Users & roles',
    description: 'See who has access to the admin area and what they can do.',
    defaultRoles: ADMINS,
  },
  'user.invite': {
    label: 'Invite staff',
    group: 'Users & roles',
    description: 'Send an email invitation to a new staff account.',
    defaultRoles: ADMINS,
  },
  'user.manage': {
    label: 'Manage staff accounts',
    group: 'Users & roles',
    description:
      'Change someone’s roles and per-person permissions, or suspend their access. Only ever applies to accounts BELOW your own role level — nobody can edit a peer or promote themselves.',
    defaultRoles: ADMINS,
  },
  'role.manage': {
    label: 'Create and edit roles',
    group: 'Users & roles',
    description:
      'Define new roles and choose exactly which permissions each one carries. The most powerful permission in the system — it can redefine what every other account is allowed to do.',
    defaultRoles: ['owner'],
  },

  /* --- Settings & audit -------------------------------------------------- */
  'settings.read': {
    label: 'View site settings',
    group: 'Settings',
    description: 'See contact details, addresses and site-wide options.',
    defaultRoles: ALL_STAFF,
  },
  'settings.write': {
    label: 'Change site settings',
    group: 'Settings',
    description:
      'Update the phone numbers, address and other details shown across every page and in the footer.',
    defaultRoles: ADMINS,
  },
  'audit.read': {
    label: 'Read the audit log',
    group: 'Settings',
    description:
      'See a record of who changed what and when. Cannot be edited or cleared by anyone.',
    defaultRoles: ADMINS,
  },
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** Permission keys held by a role on a fresh install. */
export function defaultPermissionsFor(role: RoleKey): Permission[] {
  return PERMISSION_KEYS.filter((key) =>
    (PERMISSIONS[key].defaultRoles as readonly string[]).includes(role),
  );
}

/** Permissions grouped for rendering the role editor's checkbox columns. */
export function permissionsByGroup(): Map<string, Permission[]> {
  const groups = new Map<string, Permission[]>();
  for (const key of PERMISSION_KEYS) {
    const group = PERMISSIONS[key].group;
    const bucket = groups.get(group);
    if (bucket) bucket.push(key);
    else groups.set(group, [key]);
  }
  return groups;
}
