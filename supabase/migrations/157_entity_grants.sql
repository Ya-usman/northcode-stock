-- ============================================================
-- 157 — Gestes commerciaux : membres ou boutiques offerts à une entreprise
--       (5 oct. 2026). À appliquer APRÈS la 154 (verrou serveur).
--
-- Mécanisme GÉNÉRAL (jamais un traitement propre à un client) :
--   limite effective = limite de la formule + gestes actifs.
-- Un geste : type (team_seats | shops), quantité, motif obligatoire,
-- accordé par / le, durée indéterminée (expires_at NULL) ou jusqu'à une date,
-- retrait historisé (revoked_at / revoked_by) — jamais d'effacement.
--
-- Règles (décision du 5 oct. 2026) :
--   • le geste survit aux changements de formule (il s'ajoute à la formule) ;
--   • à sa fin, personne n'est suspendu automatiquement : seules les
--     nouvelles invitations / créations sont bloquées au-delà de la limite ;
--   • accordé / retiré par le super_admin seul (routes /api/admin/*) ;
--   • n'entre jamais dans le revenu (aucune ligne d'abonnement).
--
-- Aucune donnée existante modifiée. Ré-exécutable.
-- ============================================================

CREATE TABLE IF NOT EXISTS entity_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('team_seats', 'shops')),
  quantity    int  NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  reason      text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 300),
  granted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 300)
);
CREATE INDEX IF NOT EXISTS idx_entity_grants_entity ON entity_grants(entity_id) WHERE revoked_at IS NULL;

-- Lecture : membres de l'entreprise (le propriétaire voit « dont N offert ») et super_admin
ALTER TABLE entity_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_grants_select ON entity_grants;
CREATE POLICY entity_grants_select ON entity_grants
  FOR SELECT USING (entity_id IN (SELECT get_user_entity_ids()) OR is_super_admin());

-- Écriture : serveur seul (verrou de la migration 154)
DROP TRIGGER IF EXISTS trg_entity_grants_guard ON entity_grants;
CREATE TRIGGER trg_entity_grants_guard BEFORE INSERT OR UPDATE OR DELETE ON entity_grants
  FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns('*');

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT count(*) FROM entity_grants;                                         -- 0
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trg_entity_grants_guard';     -- 1 ligne
