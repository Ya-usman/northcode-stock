'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  search: string
  page: number
  totalPages: number
  totalCount: number
  pageSize: number
}

export function PaymentsControls({ search, page, totalPages, totalCount, pageSize }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const navigate = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, val] of Object.entries(updates)) {
      if (val === null) params.delete(key)
      else params.set(key, val)
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }, [router, pathname, searchParams])

  const onSearch = (value: string) => {
    navigate({ search: value || null, page: null })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          defaultValue={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Boutique, référence Paystack…"
          className="w-full bg-muted border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} / {totalCount}
          </span>
          <button
            disabled={page <= 1}
            onClick={() => navigate({ page: String(page - 1) })}
            className="h-7 w-7 flex items-center justify-center rounded-lg border border-border bg-card hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs text-foreground font-medium">{page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => navigate({ page: String(page + 1) })}
            className="h-7 w-7 flex items-center justify-center rounded-lg border border-border bg-card hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
