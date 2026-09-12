/** Primary navigation. Split into two groups that flank the centred logo. */
export interface NavItem {
    href: string;
    label: string;
    /** Longer wording used only in the mobile drawer */
    mobileLabel?: string;
}

export const navLeft: NavItem[] = [
    { href: '/', label: 'HOME' },
    { href: '/about', label: 'ABOUT' },
    { href: '/news', label: 'NEWS' },
];

export const navRight: NavItem[] = [
    { href: '/#services', label: 'SERVICES' },
    { href: '/ori', label: 'ORI', mobileLabel: 'ORI LOOKUP' },
    { href: '/#contact', label: 'CONTACT' },
];

export const navAll: NavItem[] = [...navLeft, ...navRight];
