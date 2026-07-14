-- ============================================================
-- Migration 098 : rattrapage de total_amount pour les bons de commande
-- reçus avant l'implémentation du suivi de paiement (093)
-- ============================================================
-- 093 a ajouté purchase_orders.total_amount sans backfill — les bons déjà
-- reçus/partiels à ce moment-là sont restés à NULL (affiché 0 côté UI),
-- faisant apparaître à tort "Soldé ✓" avec Total: 0 / Payé: 0 alors que
-- leurs articles ont un vrai prix (visible sur le PDF du bon).
--
-- Choix validé avec l'utilisateur : marquer ces anciens bons comme déjà
-- payés (amount_paid = total_amount) plutôt que de faire réapparaître une
-- dette qu'il a peut-être déjà réglée hors de l'app avant que cette
-- fonctionnalité existe.

WITH computed AS (
  SELECT
    po.id,
    COALESCE(SUM(COALESCE(poi.quantity_received, poi.quantity_ordered, 0) * COALESCE(poi.unit_price, 0)), 0) AS total
  FROM purchase_orders po
  JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
  WHERE po.status IN ('received', 'partial') AND po.total_amount IS NULL
  GROUP BY po.id
)
UPDATE purchase_orders po
SET total_amount = computed.total,
    amount_paid = computed.total,
    payment_status = 'paid'
FROM computed
WHERE po.id = computed.id;
