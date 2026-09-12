/* ==========================================================================
   PERMISSION CATALOGUE — the single source of truth.

   This file defines every permission in the system and what each role gets by
   default. The database seed is GENERATED from it by
   `node scripts/generate-permission-seed.mjs`, so the catalogue in Postgres and
   the catalogue the app type-checks against can never drift apart.

   Adding a permission: add it here, re-run the generator, apply the migration.

   Important: these are DEFAULTS only. The owner can grant or revoke any
   individual permission for any individual user from the dashboard — that is
   what `user_permissions` is for. Nothing here is hardcoded into a check.
   ========================================================================== */

export const PERMISSION_CATEGORIES = {
    content: 'Website content',
    people: 'People and access',
    system: 'System',
} as const;

export type PermissionCategory = keyof typeof PERMISSION_CATEGORIES;

export interface PermissionDef {
    key: string;
    category: PermissionCategory;
    label: string;
    description: string;
}

export const PERMISSIONS = [
    // --- Website content -----------------------------------------------------
    {
        key: 'content.site.read',
        category: 'content',
        label: 'View site settings',
        description: 'See contact details, address and academy information in the dashboard.',
    },
    {
        key: 'content.site.write',
        category: 'content',
        label: 'Edit site settings',
        description: 'Change phone numbers, address and academy information shown on the site.',
    },
    {
        key: 'content.courses.read',
        category: 'content',
        label: 'View courses',
        description: 'See the course list and tuition in the dashboard.',
    },
    {
        key: 'content.courses.write',
        category: 'content',
        label: 'Edit courses and prices',
        description: 'Add, change or remove courses and their tuition. Affects what visitors are quoted.',
    },
    {
        key: 'content.news.read',
        category: 'content',
        label: 'View news entries',
        description: 'See published and draft legislation entries.',
    },
    {
        key: 'content.news.write',
        category: 'content',
        label: 'Write news entries',
        description: 'Create and edit legislation entries. Drafts are not visible to the public.',
    },
    {
        key: 'content.news.publish',
        category: 'content',
        label: 'Publish news entries',
        description: 'Make a legislation entry live on the public site, or take one down.',
    },
    {
        key: 'content.ori.read',
        category: 'content',
        label: 'View ORI directory',
        description: 'See the ORI agency directory in the dashboard.',
    },
    {
        key: 'content.ori.write',
        category: 'content',
        label: 'Edit ORI directory',
        description: 'Add, correct or retire agency ORI codes. These are used to file real paperwork.',
    },
    {
        key: 'media.upload',
        category: 'content',
        label: 'Upload images',
        description: 'Add photographs and logos to the media library.',
    },
    {
        key: 'media.delete',
        category: 'content',
        label: 'Delete images',
        description: 'Permanently remove files from the media library.',
    },

    // --- People and access ---------------------------------------------------
    {
        key: 'users.read',
        category: 'people',
        label: 'View people',
        description: 'See the list of accounts and which role each one holds.',
    },
    {
        key: 'users.invite',
        category: 'people',
        label: 'Invite people',
        description: 'Send an invitation for a new account.',
    },
    {
        key: 'users.update',
        category: 'people',
        label: 'Edit people',
        description: "Change someone's name and contact details. Does not include changing their role.",
    },
    {
        key: 'users.deactivate',
        category: 'people',
        label: 'Deactivate people',
        description: 'Switch an account off so it can no longer sign in. Nothing is deleted.',
    },
    {
        key: 'roles.manage',
        category: 'people',
        label: 'Assign roles',
        description: "Change which role someone holds. A powerful permission — it changes what they can do.",
    },
    {
        key: 'permissions.manage',
        category: 'people',
        label: 'Grant individual permissions',
        description:
            'Grant or revoke single permissions for a person, on top of their role. Nobody can grant a permission they do not themselves hold.',
    },

    // --- System --------------------------------------------------------------
    {
        key: 'settings.manage',
        category: 'system',
        label: 'Manage system settings',
        description: 'Change technical configuration for the site.',
    },
    {
        key: 'audit.read',
        category: 'system',
        label: 'Read the audit log',
        description: 'See the record of who changed what and when.',
    },
    {
        key: 'deploy.trigger',
        category: 'system',
        label: 'Trigger a rebuild',
        description: 'Republish the public site without waiting for the next scheduled build.',
    },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export interface RoleDef {
    id: string;
    label: string;
    description: string;
    /** A superuser role holds every permission implicitly and cannot be locked out. */
    isSuperuser: boolean;
    /** Permissions granted by default. Ignored for superuser roles. */
    defaults: PermissionKey[];
}

export const ROLES = [
    {
        id: 'owner',
        label: 'Owner',
        description:
            'Full control, including granting and revoking permissions for everyone else. There must always be at least one active owner.',
        isSuperuser: true,
        defaults: [],
    },
    {
        id: 'instructor',
        label: 'Instructor',
        description:
            'Teaches courses. Keeps the legislation tracker and the ORI directory current; can see tuition but not change it.',
        isSuperuser: false,
        defaults: [
            'content.site.read',
            'content.courses.read',
            'content.news.read',
            'content.news.write',
            'content.news.publish',
            'content.ori.read',
            'content.ori.write',
            'media.upload',
        ],
    },
    {
        id: 'staff',
        label: 'Staff',
        description:
            'Front-office. Keeps contact details accurate and can see everything else without changing it.',
        isSuperuser: false,
        defaults: [
            'content.site.read',
            'content.site.write',
            'content.courses.read',
            'content.news.read',
            'content.ori.read',
            'media.upload',
        ],
    },
    {
        id: 'tech',
        label: 'Tech',
        description:
            'Technical maintenance. Can configure and republish the site and read the audit log, but does not edit content or manage people by default.',
        isSuperuser: false,
        defaults: [
            'content.site.read',
            'content.courses.read',
            'content.news.read',
            'content.ori.read',
            'users.read',
            'settings.manage',
            'audit.read',
            'deploy.trigger',
        ],
    },
] as const satisfies readonly RoleDef[];

export type RoleId = (typeof ROLES)[number]['id'];

/** Convenience lookups used by the dashboard UI. */
export const permissionsByCategory = (Object.keys(PERMISSION_CATEGORIES) as PermissionCategory[])
    .map((category) => ({
        category,
        label: PERMISSION_CATEGORIES[category],
        permissions: PERMISSIONS.filter((p) => p.category === category),
    }));
