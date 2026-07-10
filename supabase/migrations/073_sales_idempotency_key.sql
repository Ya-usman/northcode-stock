-- ============================================================
-- Migration 073 : clé d'idempotence sur les ventes
-- ============================================================
-- Problème : une même vente peut être insérée plus d'une fois si le client
-- pense (à tort) qu'une tentative a échoué — timeout réseau après un succès
-- côté serveur, retry manuel du caissier, ou synchro hors-ligne relancée
-- depuis un contexte différent (service worker vs page ouverte) qui ne
-- partage pas le même verrou en mémoire que l'app.
--
-- Fix : le client génère une clé unique (UUID) une seule fois par vente,
-- avant la première tentative, et la réutilise pour toutes les tentatives
-- suivantes (y compris au sync hors-ligne). La contrainte d'unicité ici
-- garantit qu'une deuxième insertion avec la même clé échoue proprement
-- (23505) au lieu de créer un doublon — le client peut alors récupérer la
-- vente existante au lieu d'en recréer une.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_request_id uuid;

-- Index unique partiel : autorise NULL pour les lignes existantes (avant ce
-- fix) et tout code qui n'enverrait pas encore de clé, tout en garantissant
-- l'unicité pour toutes les lignes qui EN ont une.
CREATE UNIQUE INDEX IF NOT EXISTS sales_client_request_id_unique
  ON sales (client_request_id)
  WHERE client_request_id IS NOT NULL;
