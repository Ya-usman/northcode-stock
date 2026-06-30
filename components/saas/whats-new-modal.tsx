'use client'

import { X, Sparkles } from 'lucide-react'
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

const BADGE_COLORS: Record<string, string> = {
  blue:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  red:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export function WhatsNewModal({ announcements, onClose }: WhatsNewModalProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="relative w-full max-w-md rounded-2xl border bg-card shadow-2xl flex flex-col max-h-[85vh]">

          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-stockshop-blue/10">
              <Sparkles className="h-5 w-5 text-stockshop-blue dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-base text-foreground">Nouveautés</h2>
              <p className="text-xs text-muted-foreground">Dernières mises à jour de StockShop</p>
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Announcements list */}
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            {announcements.map((a, i) => (
              <div key={a.id} className={cn(
                'flex gap-4 pb-4',
                i < announcements.length - 1 && 'border-b'
              )}>
                {/* Icon */}
                <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-xl">
                  {a.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">{a.title}</span>
                    <span className={cn(
                      'text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0',
                      BADGE_COLORS[a.badge_color] ?? BADGE_COLORS.blue
                    )}>
                      {a.badge}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{a.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t shrink-0">
            <button
              onClick={onClose}
              className="w-full rounded-xl bg-stockshop-blue py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Super, j'ai compris !
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
