'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useReportingCurrency } from '@/lib/hooks/use-reporting-currency'
import { useExchangeRates } from '@/lib/hooks/use-exchange-rates'
import type { RateMap } from '@/lib/saas/exchange'

// ════════════════════════════════════════════════════════════════════════
// CONTEXTE DE REPORTING ADMIN — partagé entre plusieurs KPI d'une même page
// ════════════════════════════════════════════════════════════════════════
//
// Un seul sélecteur de devise peut piloter plusieurs tuiles/lignes non
// adjacentes dans l'arbre React (ex. le KPI « Revenus collectés » ET la
// carte « Répartition par fournisseur » plus bas sur la page Facturation).
// Sans état partagé, changer la devise ne mettrait à jour que le composant
// qui possède le `<select>` — ce contexte évite ce bug de synchronisation.
//
// Accepte des enfants rendus côté SERVEUR (le composant Provider est
// client, mais Next.js App Router autorise de lui passer du contenu server
// en `children` — c'est le pattern documenté pour entourer une section
// server-rendue d'un peu d'état client).

interface ReportingCurrencyCtx {
  currency: string
  setCurrency: (code: string) => void
  rates: RateMap
}

const Ctx = createContext<ReportingCurrencyCtx | null>(null)

export function ReportingCurrencyProvider({ children }: { children: ReactNode }) {
  const { currency, setCurrency } = useReportingCurrency()
  const { rates } = useExchangeRates()
  return <Ctx.Provider value={{ currency, setCurrency, rates }}>{children}</Ctx.Provider>
}

export function useReportingCurrencyContext(): ReportingCurrencyCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useReportingCurrencyContext doit être utilisé sous <ReportingCurrencyProvider>')
  return ctx
}
