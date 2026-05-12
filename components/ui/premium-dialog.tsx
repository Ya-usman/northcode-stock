'use client'

import * as React from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

// ── PremiumDialog ────────────────────────────────────────────────────────────
// Wrapper that enforces the app-wide premium dialog style:
//   blue header (label + title) → white body → rounded-xl action buttons

interface PremiumDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Small uppercase label shown above the title in the blue header */
  category?: string
  title: string
  /** Optional icon rendered left of the title */
  icon?: React.ReactNode
  /** Tailwind max-width class, e.g. 'max-w-sm' (default) or 'max-w-md' */
  maxWidth?: string
  children: React.ReactNode
}

export function PremiumDialog({
  open, onOpenChange, category, title, icon, maxWidth = 'max-w-sm', children,
}: PremiumDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        'p-0 gap-0',
        '[&>button]:text-white [&>button]:bg-white/20 [&>button]:hover:bg-white/35',
        maxWidth
      )}>
        <div className="rounded-lg">
          {/* Blue header */}
          <div className="bg-stockshop-blue rounded-t-lg px-5 pt-5 pb-4 pr-12">
            {category && (
              <p className="text-xs font-medium text-blue-200 uppercase tracking-wider mb-1">{category}</p>
            )}
            <div className="flex items-center gap-2.5">
              {icon && <span className="text-white/70 shrink-0">{icon}</span>}
              <p className="text-white font-semibold text-base leading-tight">{title}</p>
            </div>
          </div>
          {/* Body — rendered directly, no extra wrapper */}
          <div className="bg-background rounded-b-lg">
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── PremiumDialogBody ────────────────────────────────────────────────────────
interface PremiumDialogBodyProps {
  children: React.ReactNode
  className?: string
}

export function PremiumDialogBody({ children, className }: PremiumDialogBodyProps) {
  return (
    <div className={cn('p-5 space-y-4', className)}>
      {children}
    </div>
  )
}

// ── PremiumDialogFooter ──────────────────────────────────────────────────────
interface PremiumDialogFooterProps {
  onCancel: () => void
  cancelLabel?: string
  onConfirm?: () => void
  confirmLabel?: string
  confirmDisabled?: boolean
  confirmLoading?: boolean
  /** Red destructive style for delete/cancel actions */
  confirmDestructive?: boolean
  /** Render custom buttons instead of the default confirm button */
  children?: React.ReactNode
}

export function PremiumDialogFooter({
  onCancel, cancelLabel = 'Annuler',
  onConfirm, confirmLabel = 'Confirmer',
  confirmDisabled, confirmLoading, confirmDestructive,
  children,
}: PremiumDialogFooterProps) {
  return (
    <div className="px-5 pb-5 flex justify-center gap-3">
      <Button
        type="button"
        variant="ghost"
        className="flex-1 h-11 rounded-xl text-foreground/70 hover:text-foreground hover:bg-foreground/8 border border-border"
        onClick={onCancel}
      >
        {cancelLabel}
      </Button>
      {children}
      {onConfirm && (
        <Button
          type="button"
          className={cn(
            'flex-1 h-11 rounded-xl font-semibold',
            confirmDestructive
              ? 'bg-red-500 hover:bg-red-600 text-white border-0'
              : 'bg-stockshop-blue hover:bg-stockshop-blue-light dark:bg-blue-500 dark:hover:bg-blue-600'
          )}
          disabled={confirmDisabled}
          loading={confirmLoading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      )}
    </div>
  )
}
