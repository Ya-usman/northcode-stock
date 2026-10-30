import { StockTabs } from '@/components/stock/stock-tabs'

// Mise en page du module Stock : la barre d'onglets est posée ICI, une seule fois, et reste en place d'un onglet à
// l'autre (pas de saut ni de défilement qui repart à zéro, fond actif qui glisse). Les pages n'en posent plus.
// La barre se masque d'elle-même hors des pages d'onglet (ex. réception d'un transfert).
export default function StockLayout({ children, params: { locale } }: { children: React.ReactNode; params: { locale: string } }) {
  return (
    <div className="space-y-4">
      <StockTabs locale={locale} />
      {children}
    </div>
  )
}
