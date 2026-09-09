// Libellé + couleur par fournisseur de paiement — utilisé à la fois par un
// Server Component (app/[locale]/(admin)/admin/payments/page.tsx) et un
// Client Component (components/admin/gateway-filter.tsx). Doit vivre dans
// un module NEUTRE (sans 'use client') : un Server Component ne peut pas
// "entrer" dans un objet exporté par un module client (dot into a client
// module), seulement le passer en props tel quel — voir l'erreur React
// Server Components "Cannot access X on the server" sinon.
//
// 'legacy' = lignes créées avant la colonne `gateway` (migration 071),
// toutes via Paystack à l'époque (seul fournisseur existant alors).
export const GATEWAY_LABELS: Record<string, { name: string; color: string }> = {
  paystack:    { name: 'Paystack',    color: 'text-blue-400 bg-blue-400/10' },
  flutterwave: { name: 'Flutterwave', color: 'text-orange-400 bg-orange-400/10' },
  wave:        { name: 'Wave',        color: 'text-cyan-400 bg-cyan-400/10' },
  notchpay:    { name: 'NotchPay',    color: 'text-purple-400 bg-purple-400/10' },
  stripe:      { name: 'Stripe',      color: 'text-indigo-400 bg-indigo-400/10' },
  legacy:      { name: 'Paystack (historique)', color: 'text-muted-foreground bg-muted' },
}
