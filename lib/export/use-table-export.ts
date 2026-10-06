'use client'

// Export d'un tableau depuis une page : complète la date d'export dans la
// langue, garde l'état « en cours » et affiche l'erreur éventuelle.

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useToast } from '@/components/ui/use-toast'
import type { ExportSpec } from './table-export'

const DATE_LOCALE: Record<string, string> = { fr: 'fr-FR', en: 'en-GB', ha: 'ha-NG' }

export function useTableExport() {
  const t = useTranslations('exports')
  const locale = useLocale()
  const { toast } = useToast()
  const [exporting, setExporting] = useState(false)
  const dl = DATE_LOCALE[locale] ?? 'fr-FR'

  /** « 7 oct. 2026 » — pour composer une période */
  const day = (d: Date) => { try { return d.toLocaleDateString(dl, { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return d.toLocaleDateString('fr-FR') } }
  const range = (from: Date, to: Date) => (day(from) === day(to) ? day(from) : t('period_range', { from: day(from), to: day(to) }))

  const run = async (spec: Omit<ExportSpec, 'locale' | 'labels'>, format: 'xlsx' | 'csv', fileExtra?: string | null) => {
    setExporting(true)
    try {
      let when: string
      try { when = new Date().toLocaleString(dl, { dateStyle: 'long', timeStyle: 'short' }) } catch { when = new Date().toLocaleString('fr-FR') }
      const { exportTable } = await import('./table-export')
      await exportTable({ ...spec, locale, labels: { exportedOn: t('exported_on', { date: when }) } }, format, fileExtra)
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast({ title: err?.name === 'OfflineError' ? err.message : t('error'), variant: 'destructive' })
    } finally { setExporting(false) }
  }

  return { run, exporting, day, range, kind: (k: 'products' | 'sales' | 'cash' | 'expenses' | 'debts' | 'expiry') => t(`kinds.${k}`), total: t('total'), labelExcel: t('excel'), labelCsv: t('csv') }
}
