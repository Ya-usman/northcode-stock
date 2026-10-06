// Catalogue UNIQUE des tâches planifiées (voir vercel.json) — utilisé par la
// page Admin → Système et par le bilan du matin. Le nom doit correspondre
// exactement au job_name journalisé par lib/api/cron-log.ts. Heures en UTC.

export interface CronJob { name: string; label: string; utc: string }

export const CRON_JOBS: CronJob[] = [
  { name: 'orphan-shop-check',  label: 'Boutiques orphelines',                 utc: '04:00' },
  { name: 'recurring-expenses', label: 'Dépenses récurrentes',                 utc: '04:30' },
  { name: 'referral-maturity',  label: 'Maturation récompenses parrainage',    utc: '05:00' },
  { name: 'exchange-rates',     label: 'Taux de change (reporting)',           utc: '06:00' },
  { name: 'morning-check',      label: 'Bilan du matin (8 h, heure de Paris)', utc: '06:00/07:00' },
  { name: 'low-stock-alert',    label: 'Alerte stock faible (push)',           utc: '07:00' },
  { name: 'expiry-alert',       label: 'Alerte péremption (push)',             utc: '07:00' },
  { name: 'owner-alerts',       label: 'E-mail d\'alertes aux propriétaires', utc: '07:15' },
  { name: 'onboarding-nudges',  label: 'Relances « Bien démarrer » (e-mail)', utc: '08:00' },
  { name: 'grant-reminders',    label: 'Fin des gestes commerciaux',           utc: '08:00' },
  { name: 'renewal-check',      label: 'Renouvellement des abonnements',       utc: '09:00' },
  { name: 'evening-summary',    label: 'Résumé du soir aux propriétaires',     utc: '19:30' },
]
