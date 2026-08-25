-- ============================================================
-- 114 — Plafond de crédit par client
-- ============================================================
-- NULL = pas de plafond (comportement actuel, inchangé pour tous les
-- clients existants). Quand renseigné, une vente à crédit qui ferait
-- dépasser ce plafond affiche un avertissement côté client (sales/new)
-- mais n'est jamais bloquée côté serveur — décision explicite : un
-- plafond de crédit est indicatif, pas une contrainte dure dans cette app.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit numeric;
