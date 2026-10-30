// Colonnes d'un fournisseur qu'un écran peut lire dans le navigateur : toutes,
// SAUF le solde dû (`total_owed`). Ce que l'entreprise doit à un fournisseur
// est une donnée financière : l'écran qui en a besoin la demande au serveur
// (/api/suppliers/balances), qui applique la règle « Crédits en lecture ET
// Fournisseurs en lecture » (lib/api/supplier-access → canViewSupplierDebt).
// À tenir à jour quand une colonne est ajoutée à `suppliers` — ET, depuis la migration 183 (C3), lui donner son
// « GRANT SELECT (colonne) ON public.suppliers TO authenticated » dans la même migration : sans lui, le navigateur
// ne peut pas la lire (règle « fail-closed » : total_owed n'est jamais accordé).
// lead_time_days (migration 189, délai de livraison) : volontairement ABSENTE d'ici et sans GRANT, lue et écrite
// par le serveur seulement (/api/suppliers/lead-times, /api/stock/replenishment, /api/suppliers).
export const SUPPLIER_PUBLIC_COLUMNS = 'id, shop_id, name, phone, city, email, created_at, deleted_at'
