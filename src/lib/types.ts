/* ==========================================================================
   Domain types. These describe the shape of the academy's content regardless
   of where it is stored, which is what lets the storage layer change without
   touching a single component.
   ========================================================================== */

export interface ContactMethod {
    /** Display label, e.g. "(848) 398-0976" */
    label: string;
    /** Who or what answers, e.g. "Che' Gary" */
    detail: string;
    /** Font Awesome class, e.g. "fa-solid fa-phone" */
    icon: string;
    /** Populated for tel:/mailto: links; omit for non-actionable rows */
    href?: string;
}

export interface SiteSettings {
    name: string;
    shortName: string;
    tagline: string;
    description: string;
    domain: string;
    address: { street: string; city: string; state: string; zip: string };
    contacts: ContactMethod[];
    /** Shown in the footer copyright line */
    copyrightYear: number;
}

export interface Course {
    id: string;
    name: string;
    blurb: string;
    /** Formatted for display, e.g. "$250.00" or "$100.00+" */
    price: string;
    /** Call-to-action wording; differs between enrolment and scheduling */
    cta: string;
    category: string;
}

export interface CourseCategory {
    id: string;
    title: string;
    icon: string;
    courses: Course[];
}

export type NewsStatus = 'Pending' | 'Enacted' | 'Closed' | 'Decided';

export interface NewsSource {
    label: string;
    url: string;
}

export interface NewsEntry {
    id: string;
    title: string;
    date: string;
    status: NewsStatus | '';
    summary: string;
    sources: NewsSource[];
}

export interface NewsJurisdiction {
    code: string;
    name: string;
    categories: {
        legislation: NewsEntry[];
        cases: NewsEntry[];
    };
}

export interface NewsFeed {
    updated: string | null;
    /** While false the page shows its loading state instead of entries. */
    ready: boolean;
    states: NewsJurisdiction[];
}

/** An agency's ORI, stored as the five characters that follow the NJ prefix. */
export interface OriAgency {
    name: string;
    /** Five characters; ORI7 is 'NJ' + code, ORI9 appends '00'. */
    code: string;
}

export interface OriCounty {
    name: string;
    fips: string;
    agencies: OriAgency[];
}
