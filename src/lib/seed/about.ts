/**
 * About page content: the numbers, the three pillars, and the leadership
 * dossier.
 */

import type { Instructor, Pillar, Stat } from '../content/types';

export const SEED_ABOUT_STATS: Stat[] = [
  { id: 'years', value: '130+', label: 'Combined years in law enforcement' },
  { id: 'states', value: '2', label: 'States served: NJ & NY' },
  { id: 'curriculum', value: '100%', label: 'State-approved SORA curriculum' },
];

export const SEED_ABOUT_PILLARS: Pillar[] = [
  {
    id: 'best',
    icon: 'fa-solid fa-shield-halved',
    title: "New Jersey's Best",
    body: 'State-approved SORA instruction delivered across the whole state, built to get officers licensed, hired, and moving up. Outstanding service is the baseline, not the selling point.',
  },
  {
    id: 'tracks',
    icon: 'fa-solid fa-user-shield',
    title: 'Armed & Unarmed Training',
    body: "Both tracks are taught by instructors with real law enforcement and security experience. Whether you're starting out or renewing your credential, you leave with the skills employers actually look for.",
  },
  {
    id: 'experience',
    icon: 'fa-solid fa-medal',
    title: 'Experienced Professionals',
    body: 'With over 130 combined years of law enforcement and investigative experience, our mission is thorough, professional service for every client who walks through the door.',
  },
];

export const SEED_INSTRUCTORS: Instructor[] = [
  {
    id: 'che-gary',
    name: "Che' Gary",
    roleTitle: 'Founder & Owner / Lead SORA Instructor',
    badge: 'USMC • Ret. Newark PD',
    photoUrl: '/img/instructors/che-gary.jpg',
    photoAlt: "Che' Gary, Owner and Lead SORA Instructor",
    bio: "After serving active duty in the United States Marine Corps both here and abroad, Retired Police Officer and Detective Che' Gary went on to a highly decorated career with the Newark Police Department. A trained investigator and experienced security manager, Che' brings a wealth of experience, a unique skill set, and a keen attention to detail to a one-of-a-kind security company — and he personally leads instruction in the classroom and on the range.",
    records: [
      {
        label: 'Military Service',
        value: 'United States Marine Corps — active duty, domestic and abroad',
      },
      {
        label: 'Law Enforcement',
        value: 'Retired Police Officer / Detective, Newark Police Department',
      },
      {
        label: 'Specialties',
        value: 'Criminal investigation, security management, firearms instruction',
      },
      {
        label: 'At the Academy',
        value: 'Founder, owner, and lead instructor for all SORA certification courses',
      },
    ],
  },
];
