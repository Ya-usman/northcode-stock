'use client'

import { useState } from 'react'
import { Store, Users } from 'lucide-react'
import { AdminShopsTable } from './shops-table'
import { OwnerShopsView } from './owner-shops-view'

interface Props {
  shops: any[]
  owners: any[]
  locale: string
}

export function ShopsViewToggle({ shops, owners, locale }: Props) {
  const [view, setView] = useState<'shops' | 'owners'>('shops')

  return (
    <div className="space-y-4">
      {/* Toggle */}
      <div className="flex items-center gap-2 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setView('shops')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            view === 'shops'
              ? 'bg-card text-foreground shadow-sm border border-border'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Store className="h-4 w-4" />
          Boutiques
        </button>
        <button
          onClick={() => setView('owners')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            view === 'owners'
              ? 'bg-card text-foreground shadow-sm border border-border'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Users className="h-4 w-4" />
          Par propriétaire
        </button>
      </div>

      {view === 'shops'
        ? <AdminShopsTable shops={shops} locale={locale} />
        : <OwnerShopsView owners={owners} locale={locale} />
      }
    </div>
  )
}
