// Seuil (en jours) à partir duquel un lot est considéré "bientôt périmé".
// Une catégorie peut surcharger le réglage de la boutique ; sinon on retombe
// sur le réglage boutique, puis sur 14 jours par défaut (même valeur que
// shops.expiry_alert_days).
export function getExpiryAlertDays(
  categoryDays: number | null | undefined,
  shopDays: number | null | undefined
): number {
  return categoryDays ?? shopDays ?? 14
}
