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
  /** Center dialog vertically on mobile (use for dialogs without form inputs) */
  centered?: boolean
  children: React.ReactNode
}

export function PremiumDialog({
  open, onOpenChange, category, title, icon, maxWidth = 'max-w-sm', centered, children,
}: PremiumDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'p-0 gap-0 flex flex-col max-h-[90dvh] overflow-hidden',
          '[&>button]:text-white [&>button]:bg-white/20 [&>button]:hover:bg-white/35',
          centered && 'max-sm:!top-1/2 max-sm:!-translate-y-1/2',
          maxWidth
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex flex-col flex-1 min-h-0 rounded-lg overflow-hidden">
          {/* Gradient header — sticky */}
          <div
            className="flex-shrink-0 relative overflow-hidden rounded-t-lg px-5 pt-5 pb-4 pr-12"
            style={{ background: 'linear-gradient(135deg, #073e8a 0%, #0d52b8 100%)' }}
          >
            {/* Decorative circles */}
            <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/5" />
            <div className="absolute -bottom-4 -left-4 h-16 w-16 rounded-full bg-white/5" />
            <div className="relative">
              {(icon || category) && (
                <div className="flex items-center gap-2 mb-2">
                  {icon && (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white flex-shrink-0">
                      {icon}
                    </div>
                  )}
                  {category && (
                    <span className="text-xs font-semibold text-blue-200 uppercase tracking-wider">{category}</span>
                  )}
                </div>
              )}
              <p className="text-lg font-bold text-white leading-tight">{title}</p>
            </div>
          </div>
          {/* Body — scrollable, footer stays pinned below */}
          <div className="flex flex-col flex-1 min-h-0 bg-background rounded-b-lg overflow-hidden">
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
    <div className={cn('flex-1 overflow-y-auto p-5 space-y-4', className)}>
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
    <div className="flex-shrink-0 px-5 pb-5 pt-3 flex justify-center gap-3 border-t border-border bg-background">
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
              : 'bg-stockshop-blue hover:bg-stockshop-blue-light'
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
