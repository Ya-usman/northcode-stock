-- ============================================================
-- Migration 120 : Prix catalogue au moment de la vente
-- ============================================================
-- sale_items ne stockait jusqu'ici que unit_price (le prix réellement
-- facturé) — impossible de savoir a posteriori, depuis une vente passée,
-- qu'une ligne a été vendue en promo (ou à un prix modifié manuellement).
-- Colonne additive et nullable : NULL ou égal à unit_price = rien à
-- signaler sur le reçu (voir migration 121 pour le câblage côté
-- complete_sale, et lib/utils/pdf.ts pour l'affichage).

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS original_price numeric;
