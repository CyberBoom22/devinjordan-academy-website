import type { SiteSettings } from '@lib/types';

/* --------------------------------------------------------------------------
   Contact details, address and branding.

   TO EDIT: change the values below and merge to main — the site rebuilds
   automatically. In phase 2 these move into Supabase and become editable from
   the staff dashboard, at which point this file becomes the seed data.
   -------------------------------------------------------------------------- */
export const site: SiteSettings = {
    name: 'Devin Jordan Security Training Academy',
    shortName: 'Devin Jordan Security Training Academy',
    tagline: 'Your Security Is Our Service',
    description:
        'State-certified armed and unarmed SORA training in New Jersey and New York. Your Security is Our Service.',
    domain: 'https://devinjordansecuritytrainingacademy.com',
    address: {
        street: '613 Nye Avenue',
        city: 'Irvington',
        state: 'NJ',
        zip: '07111',
    },
    contacts: [
        {
            label: '(848) 398-0976',
            detail: "Che' Gary",
            icon: 'fa-solid fa-phone',
            href: 'tel:+18483980976',
        },
        {
            label: '(848) 398-0690',
            detail: 'Matt Porirer',
            icon: 'fa-solid fa-mobile-screen',
            href: 'tel:+18483980690',
        },
        {
            label: '613 Nye Avenue',
            detail: 'Irvington, NJ 07111',
            icon: 'fa-solid fa-location-dot',
        },
        {
            label: 'Classes statewide',
            detail: 'Call to schedule your course',
            icon: 'fa-solid fa-clock',
        },
    ],
    copyrightYear: 2026,
};
