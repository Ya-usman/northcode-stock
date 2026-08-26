-- ============================================================
-- Migration 122 : Index pour la page Contrôle de caisse
-- ============================================================
-- caisse/page.tsx interroge deux fois `payments`, filtré sur
-- (is_repayment, is_cancelled, is_write_off) puis une plage sur `paid_at` —
-- aucun index ne couvrait ces colonnes (seul idx_payments_sale_id existe,
-- 001_schema.sql), donc chaque chargement de la page forçait un scan
-- complet de TOUT l'historique des paiements, quelle que soit la journée
-- consultée — un coût qui grossit avec l'ancienneté de la boutique, pas
-- avec la taille réelle de ce qui est affiché.
--
-- Ordre des colonnes : is_repayment en tête (sépare les deux requêtes de
-- cette page), is_cancelled/is_write_off ensuite (filtres égalité), puis
-- paid_at en dernier pour un scan de plage efficace à l'intérieur du sous-
-- ensemble déjà filtré.
CREATE INDEX IF NOT EXISTS idx_payments_caisse
  ON payments (is_repayment, is_cancelled, is_write_off, paid_at);
