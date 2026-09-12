/**
 * Course catalogue as it stands today. Prices are in cents so that arithmetic
 * is exact and the display format is decided once, at render time.
 */

import type { CourseCategory } from '../content/types';

export const SEED_COURSE_CATEGORIES: CourseCategory[] = [
  {
    id: 'sora',
    name: 'SORA Training Courses',
    icon: 'fa-solid fa-shield-halved',
    courses: [
      {
        id: 'sora-unarmed',
        name: 'Unarmed SORA Certification',
        description:
          'Complete state-certified initial course. State application fee included in total.',
        priceCents: 25000,
        priceNote: null,
        ctaLabel: 'Enroll Now',
      },
      {
        id: 'sora-armed',
        name: 'Armed SORA Certification',
        description:
          'Advanced security officer training with firearms clearance. Application fee included.',
        priceCents: 26500,
        priceNote: null,
        ctaLabel: 'Enroll Now',
      },
      {
        id: 'sora-renewal',
        name: 'SORA Renewal Course',
        description: 'Mandatory state recertification for active security officers in New Jersey.',
        priceCents: 13500,
        priceNote: null,
        ctaLabel: 'Enroll Now',
      },
    ],
  },
  {
    id: 'firearms',
    name: 'Firearms & Tactical Qualifications',
    icon: 'fa-solid fa-crosshairs',
    courses: [
      {
        id: 'firearms-qualification',
        name: 'Firearms Qualification',
        description:
          'Initial firearm qualification course ($100.00). Each additional firearm qualification is $75.00.',
        priceCents: 10000,
        priceNote: '+',
        ctaLabel: 'Schedule',
      },
      {
        id: 'ccw',
        name: 'Concealed Carry (CCW)',
        description:
          'Comprehensive training including range trip, safety fundamentals, and certificate.',
        priceCents: 37600,
        priceNote: null,
        ctaLabel: 'Schedule',
      },
      {
        id: 'cpr',
        name: 'First Aid / CPR / AED',
        description: 'Adult & Pediatric CPR, AED operation, and emergency First Aid certification.',
        priceCents: 7500,
        priceNote: null,
        ctaLabel: 'Enroll Now',
      },
    ],
  },
];
