'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { BrandLogo } from '@/components/brand/brand-logo'

// Écran d'attente affiché pendant la résolution de la session (uniquement
// sans cache local : première connexion, nouvel appareil, stockage vidé).
// La coquille — barre latérale, en-tête, barre du bas — apparaît tout de
// suite avec le même gabarit que la vraie mise en page ; seule la zone de
// contenu est en attente, et sa forme suit le type de page demandé pour que
// rien ne saute à l'arrivée des données. Aucun lien réel n'est rendu : le
// rôle n'est pas encore connu.

type PageKind = 'dashboard' | 'pos' | 'list'

export function pageKindFor(pathname: string): PageKind {
  if (/\/dashboard(\/|$)/.test(pathname)) return 'dashboard'
  if (/\/sales\/new(\/|$)/.test(pathname)) return 'pos'
  return 'list'
}

// Tableau de bord : date + filtre, 4 + 2 cartes, 2 graphiques.
function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-40 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  )
}

// Nouvelle vente : recherche + catégories + grille de produits, panier à droite (≥ md).
function PosSkeleton() {
  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1 space-y-3">
        <Skeleton className="h-10 rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-12 flex-1 rounded-lg" />
          <Skeleton className="h-12 w-20 rounded-lg" />
        </div>
        <div className="flex gap-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-7 w-24 rounded-full" />)}
        </div>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-4 md:gap-3">
          {[...Array(12)].map((_, i) => <Skeleton key={i} className="aspect-[4/5] rounded-lg" />)}
        </div>
      </div>
      <div className="hidden w-[400px] shrink-0 md:block">
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}

// Listes (stock, historique, crédits, clients…) : titre + action, filtres, lignes.
function ListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-28 rounded-lg" />
      </div>
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    </div>
  )
}

export function AppShellSkeleton({ title, pathname }: { title: string; pathname: string }) {
  const kind = pageKindFor(pathname)
  return (
    <div className="min-h-screen bg-background">
      {/* Barre latérale (≥ sm) — même gabarit que <Sidebar> */}
      <aside className="hidden sm:flex sm:w-64 sm:flex-col sm:fixed sm:inset-y-0 border-r bg-card z-30" aria-hidden="true">
        <div className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #073e8a 0%, #0d52b8 100%)' }}>
          <div className="absolute -top-8 -right-8 h-28 w-28 rounded-full bg-white/5" />
          <div className="relative px-4 pt-4 pb-3">
            <BrandLogo tone="white" className="py-1.5 text-[26px]" />
          </div>
          <div className="px-4 pb-3"><div className="h-9 rounded-lg bg-white/10" /></div>
        </div>
        <div className="flex-1 space-y-5 px-3 py-4">
          {[3, 4, 3].map((n, s) => (
            <div key={s} className="space-y-1">
              <Skeleton className="ml-3 h-2.5 w-16" />
              {[...Array(n)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-3.5 w-28" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t p-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col sm:pl-64">
        {/* En-tête — même gabarit que <Header>, avec le vrai titre de la page */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-4 sm:px-6">
          <h1 className="flex-1 truncate text-base font-semibold text-foreground">{title}</h1>
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </header>
        <main className="flex-1 overflow-x-hidden p-4 pb-24 sm:p-6 sm:pb-6" aria-busy="true">
          {kind === 'dashboard' ? <DashboardSkeleton /> : kind === 'pos' ? <PosSkeleton /> : <ListSkeleton />}
        </main>
      </div>

      {/* Barre du bas (téléphone) — même gabarit que <BottomNav> */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card safe-bottom sm:hidden" aria-hidden="true">
        <div className="grid h-16 grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex flex-col items-center justify-center gap-1.5">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-2 w-8" />
            </div>
          ))}
        </div>
      </nav>
    </div>
  )
}
