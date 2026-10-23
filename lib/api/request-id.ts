// Identifiant de requête (idempotence des paiements, synchronisation hors connexion).
// Formats produits par l'application : UUID (crypto.randomUUID) ou « local-<horodatage>-<suffixe> ».
// Lettres, chiffres et tirets uniquement : aucun caractère joker de LIKE (« % », « _ ») ne peut élargir la recherche.
export function isRequestId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9-]{1,120}$/.test(v)
}
