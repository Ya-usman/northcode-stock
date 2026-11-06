// Icônes des pages publiques (tracés de la maquette validée v5/v6), sans dépendance : rendues par le serveur.
import type { ReactNode } from 'react'

const Svg = ({ children, size, stroke = 1.8 }: { children: ReactNode; size?: number; stroke?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

export const IconCart = () => <Svg><path d="M3 4h2l2.4 11h10.2L20 7H6.3" /><circle cx="9" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></Svg>
export const IconAlert = () => <Svg><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17h.01" /></Svg>
export const IconChart = () => <Svg><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>
export const IconKey = () => <Svg><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M14 9l2 2" /></Svg>
export const IconStore = () => <Svg><path d="M3 9l1.5-5h15L21 9M3 9h18M3 9a2.5 2.5 0 005 0 2.5 2.5 0 005 0 2.5 2.5 0 005 0 2.5 2.5 0 003 0M5 11v9h14v-9M10 20v-5h4v5" /></Svg>
export const IconOffline = () => <Svg><path d="M2 2l20 20M8.5 16.5a5 5 0 017 0M5 12.6a10 10 0 015.2-2.7M19 12.6a10 10 0 00-2.2-1.5M2 8.8a15 15 0 014.2-2.6M22 8.8A15 15 0 0011.5 5M12 20h.01" /></Svg>
export const IconCoins = () => <Svg><circle cx="9" cy="9" r="6" /><path d="M15.4 9.6A6 6 0 1110 18.6" /><path d="M9 6v6M7 8h3.5" /></Svg>
export const IconGlobe = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></Svg>
export const IconShield = () => <Svg><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></Svg>
export const IconDevices = () => <Svg><rect x="2" y="4" width="14" height="10" rx="1.5" /><path d="M6 18h6" /><rect x="17" y="8" width="5" height="12" rx="1.2" /></Svg>
export const IconSync = () => <Svg><path d="M20 11a8 8 0 00-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0014.5 4.5L20 16M20 20v-4h-4" /></Svg>
export const IconCheck = () => <Svg stroke={2.4}><path d="M5 12l5 5 9-10" /></Svg>
export const IconArrow = () => <Svg size={16} stroke={2}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>
export const IconChevron = () => <Svg size={16} stroke={2}><path d="M9 6l6 6-6 6" /></Svg>
export const IconChevronDown = () => <Svg size={14} stroke={2}><path d="M6 9l6 6 6-6" /></Svg>
export const IconBack = () => <Svg size={18} stroke={2}><path d="M15 6l-6 6 6 6" /></Svg>
export const IconMoon = () => <Svg size={18}><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></Svg>
export const IconSun = () => <Svg size={18}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>
export const IconMenu = () => <Svg size={20} stroke={2}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>
export const IconClose = () => <Svg size={20} stroke={2}><path d="M6 6l12 12M18 6L6 18" /></Svg>
export const IconLanguage = () => <Svg size={16}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></Svg>
// Métiers (lot C)
export const IconHealth = () => <Svg><path d="M12 21s-7.5-4.6-9.2-9.4C1.6 8.2 3.8 5 7.2 5c2 0 3.6 1.1 4.8 2.8C13.2 6.1 14.8 5 16.8 5c3.4 0 5.6 3.2 4.4 6.6C19.5 16.4 12 21 12 21z" /><path d="M12 10v5M9.5 12.5h5" /></Svg>
export const IconTools = () => <Svg><path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></Svg>
export const IconSchool = () => <Svg><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6" /></Svg>
export const IconCalendar = () => <Svg><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>
export const IconPlus = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Svg>
export const IconFlask = () => <Svg><path d="M9 3h6M10 3v6l-5.5 9.5A2 2 0 006.2 21h11.6a2 2 0 001.7-2.5L14 9V3" /><path d="M7.5 15h9" /></Svg>
export const IconPill = () => <Svg><rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)" /><path d="M8.5 8.5l7 7" /></Svg>
