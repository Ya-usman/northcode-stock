-- ============================================================
-- Migration 146 : exchange_rates — dédup historique, contrainte réelle,
--                  nouvelle politique de rétention (préparation taux datés)
-- ============================================================
-- Contexte : jusqu'ici la seule contrainte d'unicité portait sur
-- (base_currency, quote_currency, as_of) — un timestamp EXACT. Chaque
-- rafraîchissement (cron ou manuel) génère un `as_of` différent, donc
-- aucun conflit ne se produisait jamais : 565 lignes se sont accumulées
-- pour seulement 3 dates calendaires distinctes (effective_date), soit
-- 522 lignes strictement redondantes sur 43 groupes réels
-- (devise source, devise cible, effective_date, provider).
--
-- Audité avant migration : 0 groupe avec des taux DIVERGENTS pour la même
-- clé (aucune ligne à arbitrer) — la vérification ci-dessous le revalide
-- au moment de l'exécution et ANNULE la migration si ce n'est plus vrai,
-- plutôt que de supprimer des données aveuglément.
--
-- Cette migration prépare le terrain pour les taux historiques par date
-- (effective_date déjà présente depuis la migration 139, réutilisée telle
-- quelle) : sans une vraie contrainte sur (devise, devise, date, provider),
-- le backfill historique recréerait le même problème à grande échelle.

-- ── 1. Garde-fou : refuser de dédupliquer s'il existe un vrai désaccord ──
DO $$
DECLARE
  v_anomalies integer;
BEGIN
  SELECT count(*) INTO v_anomalies FROM (
    SELECT base_currency, quote_currency, effective_date, provider
    FROM exchange_rates
    GROUP BY base_currency, quote_currency, effective_date, provider
    HAVING count(DISTINCT rate) > 1
  ) t;

  IF v_anomalies > 0 THEN
    RAISE EXCEPTION
      'exchange_rates : % groupe(s) (devise, devise, date, provider) avec des taux DIVERGENTS — dédup automatique annulée, arbitrer manuellement avant de relancer cette migration',
      v_anomalies;
  END IF;
END $$;

-- ── 2. Sauvegarde logique avant suppression (snapshot, une seule fois) ──
-- Ré-exécuter cette migration après un 1er passage réussi est un no-op ici
-- (la table de sauvegarde existe déjà) — elle capture l'état PRÉ-dédup,
-- jamais un état déjà nettoyé.
CREATE TABLE IF NOT EXISTS exchange_rates_pre_dedup_146 AS
  SELECT * FROM exchange_rates;

-- ── 3. Déduplication : 1 ligne par (devise source, devise cible,
--       effective_date, provider) — on garde la plus récente (created_at,
--       puis fetched_at, puis id en dernier recours déterministe) ──
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY base_currency, quote_currency, effective_date, provider
      ORDER BY created_at DESC, fetched_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM exchange_rates
)
DELETE FROM exchange_rates
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── 4. Durcissement : ces deux colonnes sont désormais la clé de dédup,
--       elles ne peuvent plus rester NULL (aucune ligne actuelle ne l'est —
--       cet ALTER échoue bruyamment sinon, plutôt que de laisser passer
--       des doublons invisibles à la contrainte via NULL <> NULL) ──
ALTER TABLE exchange_rates ALTER COLUMN effective_date SET NOT NULL;
ALTER TABLE exchange_rates ALTER COLUMN provider SET NOT NULL;

-- ── 5. La vraie contrainte d'unicité (idempotent) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'exchange_rates'::regclass
      AND conname = 'exchange_rates_pair_date_provider_uniq'
  ) THEN
    ALTER TABLE exchange_rates
      ADD CONSTRAINT exchange_rates_pair_date_provider_uniq
      UNIQUE (base_currency, quote_currency, effective_date, provider);
  END IF;
END $$;

-- Index de lecture pour la sélection par date (utilisé par le futur moteur
-- de conversion historique — "dernier effective_date <= date demandée").
CREATE INDEX IF NOT EXISTS idx_exchange_rates_effective_date
  ON exchange_rates (base_currency, quote_currency, effective_date DESC);

-- ── 6. Nouvelle politique de rétention ──────────────────────────────────
-- Remplace l'ancienne purge par ancienneté (120 jours), incompatible avec
-- la conservation de taux historiques sur plusieurs années (rapports
-- annuels, comparaisons N/N-1). La fonction ne supprime plus JAMAIS un
-- taux en fonction de son âge — uniquement :
--   (a) de vrais doublons résiduels (filet de sécurité si jamais la
--       contrainte de l'étape 5 était contournée par un chemin d'écriture
--       qui ne passe pas par upsert/onConflict) ;
--   (b) des lignes explicitement marquées comme données techniques
--       temporaires (aucun mécanisme de ce type n'existe à ce jour —
--       prévu pour extension future, ex. un flag `is_cache_probe`).
-- Tout le reste — y compris un taux vieux de plusieurs années — est
-- conservé indéfiniment.
CREATE OR REPLACE FUNCTION prune_exchange_rates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH doomed AS (
    DELETE FROM exchange_rates e
    WHERE EXISTS (
      SELECT 1 FROM exchange_rates dup
      WHERE dup.base_currency  = e.base_currency
        AND dup.quote_currency = e.quote_currency
        AND dup.effective_date = e.effective_date
        AND dup.provider       = e.provider
        AND (
          dup.created_at > e.created_at
          OR (dup.created_at = e.created_at AND dup.id > e.id)
        )
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM doomed;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION prune_exchange_rates() IS
  'Supprime uniquement les vrais doublons (base_currency, quote_currency, effective_date, provider) — ne purge plus par ancienneté depuis la migration 146. Les taux historiques sont conservés indéfiniment.';
