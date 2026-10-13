// Journal des ventes (Historique des ventes › Journal) : ce que chaque ligne
// affiche. Une règle par action connue — jamais une action inconnue présentée
// comme un paiement validé, jamais un identifiant technique à la place d'un
// numéro de vente.

export type SaleLogKind =
  | 'cancel' | 'edit' | 'validate' | 'postpone' | 'reviewed' | 'offline_synced'
  | 'opening_created' | 'opening_cancelled' | 'other'

export type SaleLogTone = 'red' | 'blue' | 'green' | 'neutral'

export interface SaleLogEntry {
  kind: SaleLogKind
  /** Clé de traduction du libellé d'action (namespace racine) */
  labelKey: string
  tone: SaleLogTone
  /** Numéro lisible (vente ou reprise de dette) ; null si le journal n'en a pas gardé */
  number: string | null
}

const RULES: Record<string, { kind: SaleLogKind; tone: SaleLogTone }> = {
  'sale.cancel':            { kind: 'cancel',            tone: 'red' },
  'sale.edit':              { kind: 'edit',              tone: 'blue' },
  'sale.validate_payment':  { kind: 'validate',          tone: 'green' },
  'sale.postpone_due_date': { kind: 'postpone',          tone: 'blue' },
  'sale.reviewed':          { kind: 'reviewed',          tone: 'green' },
  'sale.offline_synced':    { kind: 'offline_synced',    tone: 'blue' },
  'debt.opening_created':   { kind: 'opening_created',   tone: 'green' },
  'debt.opening_cancelled': { kind: 'opening_cancelled', tone: 'red' },
}

export function describeSaleLog(log: { action?: string | null; metadata?: Record<string, any> | null }): SaleLogEntry {
  const rule = RULES[log.action || ''] ?? { kind: 'other' as const, tone: 'neutral' as const }
  const meta = log.metadata || {}
  const raw = meta.sale_number ?? meta.number
  const number = typeof raw === 'string' && raw.trim() ? raw.trim() : null
  return { ...rule, labelKey: `sales.log_action_${rule.kind}`, number }
}
