import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils/cn'

// Coquille de tableau standard pour l'admin — en-tête, squelette de
// chargement, état vide, et un emplacement pour les actions par ligne.
// Chaque page admin garde le contrôle total du contenu de ses lignes
// (renderRow) ; ce composant ne standardise que ce qui les entoure —
// remplace les balisages de tableau dupliqués (shops-table.tsx,
// payments/page.tsx, stock/page.tsx admin...).
export interface AdminTableColumn {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  className?: string
}

interface AdminTableProps<T> {
  columns: AdminTableColumn[]
  rows: T[]
  /** Renvoie le CONTENU d'une ligne (des <td>...</td>) — le <tr> englobant
   *  (bordure, survol) est déjà fourni par AdminTable. */
  renderRow: (row: T, index: number) => ReactNode
  rowKey: (row: T, index: number) => string
  loading?: boolean
  skeletonRows?: number
  emptyMessage?: string
}

export function AdminTable<T>({
  columns, rows, renderRow, rowKey, loading, skeletonRows = 5, emptyMessage = 'Aucun résultat.',
}: AdminTableProps<T>) {
  return (
    <div className="rounded-xl border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
            {columns.map(col => (
              <th
                key={col.key}
                className={cn(
                  'font-medium px-3 py-2.5 whitespace-nowrap',
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [...Array(skeletonRows)].map((_, i) => (
              <tr key={i} className="border-b last:border-0">
                <td colSpan={columns.length} className="px-3 py-3">
                  <Skeleton className="h-6 w-full" />
                </td>
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => <tr key={rowKey(row, i)} className="border-b last:border-0 hover:bg-muted/20 transition-colors">{renderRow(row, i)}</tr>)
          )}
        </tbody>
      </table>
    </div>
  )
}
