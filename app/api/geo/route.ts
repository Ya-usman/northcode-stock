import { NextRequest, NextResponse } from 'next/server'

// Pays du visiteur selon l'hébergeur (x-vercel-ip-country), pour PRÉSÉLECTIONNER le pays de la section Tarifs de la
// page d'accueil. Affichage seulement : aucun prix ni droit n'en dépend (prix payé : lib/saas/pricing-country).
export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  const c = (request.headers.get('x-vercel-ip-country') || '').toUpperCase()
  return NextResponse.json({ country: /^[A-Z]{2}$/.test(c) ? c : null }, { headers: { 'Cache-Control': 'private, no-store' } })
}
