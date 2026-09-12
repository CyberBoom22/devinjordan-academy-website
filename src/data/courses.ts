import type { CourseCategory } from '@lib/types';

/* --------------------------------------------------------------------------
   Courses and tuition.

   TO EDIT A PRICE: change the `price` string below. It is stored as display
   text rather than a number on purpose — the academy quotes "$100.00+" for
   firearms qualification, which no numeric type represents honestly.
   -------------------------------------------------------------------------- */
export const courseCategories: CourseCategory[] = [
    {
        id: 'sora',
        title: 'SORA Training Courses',
        icon: 'fa-solid fa-shield-halved',
        courses: [
            {
                id: 'sora-unarmed',
                name: 'Unarmed SORA Certification',
                blurb: 'Complete state-certified initial course. State application fee included in total.',
                price: '$250.00',
                cta: 'ENROLL NOW',
                category: 'sora',
            },
            {
                id: 'sora-armed',
                name: 'Armed SORA Certification',
                blurb: 'Advanced security officer training with firearms clearance. Application fee included.',
                price: '$265.00',
                cta: 'ENROLL NOW',
                category: 'sora',
            },
            {
                id: 'sora-renewal',
                name: 'SORA Renewal Course',
                blurb: 'Mandatory state recertification for active security officers in New Jersey.',
                price: '$135.00',
                cta: 'ENROLL NOW',
                category: 'sora',
            },
        ],
    },
    {
        id: 'firearms',
        title: 'Firearms & Tactical Qualifications',
        icon: 'fa-solid fa-crosshairs',
        courses: [
            {
                id: 'firearms-qual',
                name: 'Firearms Qualification',
                blurb: 'Initial firearm qualification course ($100.00). Each additional firearm qualification is $75.00.',
                price: '$100.00+',
                cta: 'SCHEDULE',
                category: 'firearms',
            },
            {
                id: 'ccw',
                name: 'Concealed Carry (CCW)',
                blurb: 'Comprehensive training including range trip, safety fundamentals, and certificate.',
                price: '$376.00',
                cta: 'SCHEDULE',
                category: 'firearms',
            },
            {
                id: 'cpr',
                name: 'First Aid / CPR / AED',
                blurb: 'Adult & Pediatric CPR, AED operation, and emergency First Aid certification.',
                price: '$75.00',
                cta: 'ENROLL NOW',
                category: 'firearms',
            },
        ],
    },
];
