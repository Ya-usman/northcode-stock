'use client'

// Nouveautés V2 : icône de l'en-tête, panneau latéral, bandeau de page.
// Jamais de fenêtre qui s'impose : chacun consulte quand il veut ; la
// nouveauté est rappelée seulement sur la page qu'elle concerne.

import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, Sparkles, TrendingUp, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppDrawer } from '@/components/ui/app-drawer'
import { cn } from '@/lib/utils/cn'
import { startNavigationProgress } from '@/components/layout/navigation-progress'
import type { Announcement, AnnouncementKind } from '@/lib/announcements/use-announcements'

const KIND: Record<AnnouncementKind, { icon: typeof Sparkles; chip: string }> = {
  new: { icon: Sparkles, chip: 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/50 dark:text-blue-400' },
  improvement: { icon: TrendingUp, chip: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400' },
  fix: { icon: Wrench, chip: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
}

function useGo() {
  const router = useRouter()
  const locale = useLocale()
  return (path: string) => {
    const href = `/${locale}/${path}`
    startNavigationProgress(href)
    router.push(href)
  }
}

/** Icône de l'en-tête ; point bleu tant qu'il y a du nouveau depuis la dernière ouverture */
export function WhatsNewButton({ hasUnread, onOpen }: { hasUnread: boolean; onOpen: () => void }) {
  const t = useTranslations('whats_new')
  return (
    <Button variant="ghost" size="icon" onClick={onOpen} className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
      aria-label={hasUnread ? t('open_unread') : t('open')} title={t('title')} data-testid="whats-new-button">
      <Sparkles className="h-4 w-4" />
      {hasUnread && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-stockshop-blue ring-2 ring-card dark:bg-blue-400" data-testid="whats-new-dot" />}
    </Button>
  )
}

export function WhatsNewPanel({ open, onOpenChange, items }: { open: boolean; onOpenChange: (o: boolean) => void; items: Announcement[] }) {
  const t = useTranslations('whats_new')
  const go = useGo()
  return (
    <AppDrawer open={open} onOpenChange={onOpenChange} category="StockShop" title={t('title')} description={t('subtitle')}
      icon={<Sparkles className="h-4 w-4" />} width="md" testId="whats-new-panel">
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="space-y-3">
          {items.map(a => <AnnouncementCard key={a.id} item={a} onTry={() => { onOpenChange(false); go(a.ctaPath!) }} />)}
        </ol>
      )}
    </AppDrawer>
  )
}

/** Carte d'une nouveauté (panneau ; aperçu de l'éditeur admin avec onTry absent) */
export function AnnouncementCard({ item: a, onTry }: { item: Announcement; onTry?: () => void }) {
  const t = useTranslations('whats_new')
  const locale = useLocale()
  const k = KIND[a.kind] ?? KIND.new
  return (
    <li className="list-none rounded-xl border bg-card p-4 shadow-sm" data-testid="whats-new-item">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', k.chip)}>
          <k.icon className="h-3 w-3" />{t(`kind_${a.kind}` as any)}
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(a.publishedAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
        {a.unread && <span className="ml-auto h-2 w-2 rounded-full bg-stockshop-blue dark:bg-blue-400" aria-label={t('unread')} />}
      </div>
      <h3 className="mt-2 break-words text-sm font-semibold">{a.title}</h3>
      <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{a.description}</p>
      {a.ctaPath && (
        <Button variant="outline" size="sm" className="mt-3 h-9 gap-1.5" onClick={onTry} disabled={!onTry} tabIndex={onTry ? undefined : -1}>
          {t('try')}<ArrowRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  )
}

/** Bandeau discret en haut de la page concernée ; fermé une fois pour toutes par la personne */
export function PageAnnouncement({ item, currentPath, onDismiss, preview = false }: { item: Announcement; currentPath: string; onDismiss: (id: string) => void; preview?: boolean }) {
  const t = useTranslations('whats_new')
  const navigate = useGo()
  const go = (path: string) => { if (!preview) navigate(path) } // aperçu admin : boutons inertes
  const k = KIND[item.kind] ?? KIND.new
  const showTry = item.ctaPath && currentPath !== item.ctaPath
  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-stockshop-blue/20 bg-stockshop-blue-muted/60 px-4 py-3 dark:border-blue-900/60 dark:bg-blue-950/30" data-testid="page-announcement">
      <k.icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-stockshop-blue dark:text-blue-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-semibold text-stockshop-blue dark:text-blue-400">{t(`kind_${item.kind}` as any)} · </span>
          <span className="font-medium">{item.title}</span>
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
      </div>
      {showTry && (
        <Button variant="ghost" size="sm" className="h-8 flex-shrink-0 gap-1 px-2 text-xs font-medium text-stockshop-blue hover:text-stockshop-blue dark:text-blue-400" onClick={() => go(item.ctaPath!)}>
          {t('try')}<ArrowRight className="h-3.5 w-3.5" />
        </Button>
      )}
      <button type="button" onClick={() => onDismiss(item.id)} aria-label={t('dismiss')} title={t('dismiss')}
        className="-mr-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground" data-testid="page-announcement-dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
