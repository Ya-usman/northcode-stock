'use client'

import { useCallback, useEffect, useState } from 'react'

// ════════════════════════════════════════════════════════════════════════
// DEVISE DE REPORTING ADMIN — StockShop
// ════════════════════════════════════════════════════════════════════════
//
// StockShop est piloté depuis le Cameroun : la devise de référence interne
// (Command Center, Analytics, Facturation, Agents…) est XAF PAR DÉFAUT.
// Ceci ne change RIEN à la devise métier des boutiques (shop_currency) ni
// à la devise de facturation de l'abonnement (billing_currency, EUR pour
// l'UE) — c'est une 3e devise, purement d'AFFICHAGE consolidé, jamais
// stockée ni appliquée à une transaction réelle.
//
// Préférence persistée par navigateur (localStorage, comme le sélecteur du
// panneau Parrainage dont celui-ci reprend et généralise le pattern) — pas
// par compte admin en base : aucune donnée sensible, faible enjeu, cohérent
// avec l'existant.

const STORAGE_KEY = 'stockshop_admin_reporting_currency'
export const DEFAULT_REPORTING_CURRENCY = 'XAF'

export function useReportingCurrency() {
  const [currency, setCurrencyState] = useState(DEFAULT_REPORTING_CURRENCY)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setCurrencyState(saved)
    } catch { /* localStorage indisponible (navigation privée…) — XAF reste le défaut */ }
  }, [])

  const setCurrency = useCallback((code: string) => {
    setCurrencyState(code)
    try { localStorage.setItem(STORAGE_KEY, code) } catch { /* ignore */ }
  }, [])

  return { currency, setCurrency }
}
