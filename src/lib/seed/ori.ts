/**
 * ORI directory loader.
 *
 * The JSON beside this file stores each county as [name, fips, agencies] and
 * each agency as [name, core], which keeps 640 rows compact. This module is
 * the only place that knows about that shape — everything downstream works
 * with typed OriCounty objects.
 */

import type { OriCounty } from '../content/types';
import raw from './ori-data.json';

type RawCounty = [string, string, [string, string][]];

export const SEED_ORI_COUNTIES: OriCounty[] = (raw.counties as unknown as RawCounty[]).map(
  ([name, fips, agencies]) => ({
    fips,
    name,
    agencies: agencies.map(([agencyName, core]) => ({ name: agencyName, core })),
  }),
);

/** 'NJ' + the five stored characters. The short form. */
export function ori7(core: string): string {
  return `NJ${core}`;
}

/** The ORI7 with two padding characters. The form nearly every form expects. */
export function ori9(core: string): string {
  return `NJ${core}00`;
}

/** The three explainer cards beneath the ORI7 / ORI9 comparison. */
export const SEED_ORI_PILLARS = [
  {
    id: 'what',
    icon: 'fa-solid fa-fingerprint',
    title: 'What an ORI Is',
    body: 'An Originating Agency Identifier is the FBI-assigned code for a law enforcement agency. In New Jersey every code starts with NJ, followed by the county and municipality digits — NJ0010100 is Absecon PD in Atlantic County.',
  },
  {
    id: 'when',
    icon: 'fa-solid fa-file-signature',
    title: "When You'll Need One",
    body: 'Firearms applications — FID card, permit to purchase, and concealed carry — ask for the ORI of the investigating agency, which is the police department covering where you live.',
  },
  {
    id: 'where',
    icon: 'fa-solid fa-clipboard-check',
    title: 'Where It Goes',
    body: 'You enter it when scheduling live-scan fingerprints, alongside the service code your application supplies. SORA registration itself uses a service code from the NJSP portal, not an ORI you look up here.',
  },
];
