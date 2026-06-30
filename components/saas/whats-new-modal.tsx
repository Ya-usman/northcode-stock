'use client'

import { X, Sparkles, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export interface Announcement {
  id: string
  title: string
  description: string
  icon: string
  badge: string
  badge_color: string
  published_at: string
}

interface WhatsNewModalProps {
  announcements: Announcement[]
  onClose: () => void
}

const BADGE_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  blue:  { dot: 'bg-blue-500',  text: 'text-blue-600 dark:text-blue-400',  bg: 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800' },
  green: { dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800' },
  amber: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800' },
  red:   { dot: 'bg-red-500',   text: 'text-red-600 dark:text-red-400',    bg: 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800' },
}

export function WhatsNewModal({ announcements, onClose }: WhatsNewModalProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="relative w-full max-w-md rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-200">

          {/* Premium gradient header */}
          <div
            className="relative shrink-0 px-6 pt-7 pb-6 overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #073e8a 0%, #1560c0 60%, #0ea5e9 100%)' }}
          >
            {/* Decorative blobs */}
            <div className="absolute -top-10 -right-10 h-36 w-36 rounded-full bg-white/10" />
            <div className="absolute -bottom-8 -left-8 h-28 w-28 rounded-full bg-white/5" />
            <div className="absolute top-4 right-16 h-6 w-6 rounded-full bg-yellow-300/30" />

            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Icon + title */}
            <div className="relative flex items-center gap-3 mb-1">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                <Sparkles className="h-6 w-6 text-yellow-300" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-blue-200 uppercase tracking-widest">StockShop</p>
                <h2 className="text-xl font-bold text-white leading-tight">Nouveautés</h2>
              </div>
            </div>
            <p className="relative text-sm text-blue-100/80 mt-1">
              {announcements.length} mise{announcements.length > 1 ? 's' : ''} à jour disponible{announcements.length > 1 ? 's' : ''}
            </p>
          </div>

          {/* Announcements list */}
          <div className="overflow-y-auto flex-1 bg-card px-5 py-5 space-y-3">
            {announcements.map((a, i) => {
              const style = BADGE_STYLES[a.badge_color] ?? BADGE_STYLES.blue
              return (
                <div
                  key={a.id}
                  className={cn(
                    'flex gap-4 rounded-2xl border p-4 transition-colors',
                    style.bg
                  )}
                >
                  {/* Emoji icon */}
                  <div className="shrink-0 flex h-12 w-12 items-center justify-center rounded-xl bg-white dark:bg-white/10 shadow-sm text-2xl">
                    {a.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-bold text-sm text-foreground">{a.title}</span>
                      <span className={cn('flex items-center gap-1 text-[10px] font-semibold shrink-0', style.text)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
                        {a.badge}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{a.description}</p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="shrink-0 bg-card border-t px-5 py-4">
            <button
              onClick={onClose}
              className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #073e8a 0%, #1560c0 100%)' }}
            >
              Continuer
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
