/**
 * Built-in site content.
 *
 * This is the content the academy's site launched with, kept in the repository
 * so the site renders correctly with no database attached — a fresh clone runs
 * and looks right immediately, and a Supabase outage degrades to "slightly out
 * of date" instead of "blank page".
 *
 * Once the database is seeded (supabase/seed.sql is generated from this file),
 * these values are only a fallback. Edits made by the academy in the admin area
 * always win.
 */

import type { ContactMethod, SiteSettings } from '../content/types';

export const SEED_SETTINGS: SiteSettings = {
  'site.name': 'Devin Jordan Security Training Academy',
  'site.tagline': 'Your Security Is Our Service',
  'site.description':
    'State-certified armed and unarmed SORA training in New Jersey and New York. Your Security is Our Service.',
  'contact.primary.name': "Che' Gary",
  'contact.primary.phone': '(848) 398-0976',
  'contact.secondary.name': 'Matt Porirer',
  'contact.secondary.phone': '(848) 398-0690',
  'contact.address.street': '613 Nye Avenue',
  'contact.address.locality': 'Irvington, NJ 07111',
  'contact.hours.headline': 'Classes statewide',
  'contact.hours.detail': 'Call to schedule your course',
  'legal.copyright': 'Devin Jordan Security Training Academy',
};

/** Digits only, for tel: hrefs. */
export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `tel:+1${digits}`;
}

export function contactMethods(settings: SiteSettings): ContactMethod[] {
  const methods: ContactMethod[] = [];
  const primaryPhone = settings['contact.primary.phone'];
  const secondaryPhone = settings['contact.secondary.phone'];

  if (primaryPhone) {
    methods.push({
      icon: 'fa-solid fa-phone',
      primary: primaryPhone,
      secondary: settings['contact.primary.name'] ?? '',
      href: telHref(primaryPhone),
    });
  }

  if (secondaryPhone) {
    methods.push({
      icon: 'fa-solid fa-mobile-screen',
      primary: secondaryPhone,
      secondary: settings['contact.secondary.name'] ?? '',
      href: telHref(secondaryPhone),
    });
  }

  if (settings['contact.address.street']) {
    methods.push({
      icon: 'fa-solid fa-location-dot',
      primary: settings['contact.address.street'],
      secondary: settings['contact.address.locality'] ?? '',
    });
  }

  if (settings['contact.hours.headline']) {
    methods.push({
      icon: 'fa-solid fa-clock',
      primary: settings['contact.hours.headline'],
      secondary: settings['contact.hours.detail'] ?? '',
    });
  }

  return methods;
}

/** Named copy blocks, keyed as `<page>.<block>`. */
export const SEED_COPY: Record<string, string> = {
  'home.hero.line1': 'Your Security',
  'home.hero.line2': 'is our',
  'home.hero.line3': 'Service',
  'home.hero.subheading': 'Secure your future with elite training',
  'home.hero.cta': 'Explore Courses',

  'home.about.heading': 'Elite Standards.\nUnyielding Protocol.',
  'home.about.subheading': "Preparing New Jersey's Best",
  'home.about.body':
    "Devin Jordan Security Training Academy delivers state-approved SORA instruction for security professionals across Northern, Central, and Southern New Jersey — and now New York. We don't just teach the curriculum; we forge readiness, situational dominance, and unshakeable confidence.\n\nFrom SORA compliance and firearms qualifications to CPR and active shooter response, our instructors bring real law enforcement and military experience straight into the classroom and onto the range.",
  'home.about.cta': 'Meet the Academy',

  'home.services.heading': 'Academy Services & Tuition',
  'home.services.subheading': 'State Approved • Professional Certification',

  'home.contact.heading': 'Take\nCommand\nof your\nTraining',
  'home.contact.subheading': 'Contact Academy',

  'about.creed':
    'Bonded by a lifetime of trust and service to {{the country}} and {{the community}}.',
  'about.intro.heading': "New Jersey's\nBest.",
  'about.intro.subheading': 'Trained to a higher standard',
  'about.intro.body':
    "We offer armed and unarmed SORA certification classes throughout Northern, Central, and Southern New Jersey — and now New York as well. Our SORA-certified instructors deliver the state-approved training security officers need to get licensed, get hired, and advance their careers.\n\nWe're a professional organization that prides itself on outstanding customer service, hands-on instruction, and professional excellence in every class we teach.",
  'about.pillars.heading': 'What sets the {{Academy}} apart',
  'about.leadership.heading': 'Command {{Leadership}}',

  'news.disclaimer':
    'These summaries are provided as a convenience for security professionals and are not a substitute for the actual text of a law or for advice from a licensed attorney. Laws change frequently and summaries may lag behind the current status. Always verify against the linked primary sources before acting, and consult an attorney for guidance on your specific situation.',

  'ori.disclaimer':
    'ORI codes are assigned and maintained by the FBI and the New Jersey State Police, and agencies are occasionally merged, renamed, or retired. This directory is provided as a convenience for our students. Confirm the code with the agency handling your application before submitting a form or scheduling fingerprints.',
};
