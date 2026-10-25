-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 180 — Notes : objets manquants de la migration 046 — BROUILLON, NON APPLIQUÉ
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Audit du 25 oct. 2026 : la 046 n'est appliquée qu'en partie en production. La table notes, la RLS et ses 4
-- politiques existent (la 062 les recrée à l'identique) ; manquent les deux index, la fonction et le déclencheur
-- de mise à jour de updated_at. Conséquence : une note modifiée garde son updated_at de création (0 note sur 23 avec
-- updated_at > created_at), alors que l'écran Notes trie et affiche par updated_at.
--
-- Cette migration NE REJOUE PAS la 046 : elle recrée UNIQUEMENT ces quatre objets, avec le SQL de la 046 (noms
-- qualifiés public. pour ne dépendre d'aucun search_path). Table, colonnes, RLS, politiques et droits de notes :
-- inchangés. AUCUNE donnée modifiée : les notes existantes gardent leur updated_at ; à partir d'ici, toute
-- modification d'une note met updated_at à now().
-- Rejouable : IF NOT EXISTS (index), CREATE OR REPLACE (fonction), DROP TRIGGER IF EXISTS puis CREATE TRIGGER
-- (déclencheur, comme dans la 046). Transaction EXPLICITE (BEGIN / COMMIT) : si une instruction échoue, aucun état
-- partiel ne reste, quel que soit le client ; jamais d'instant sans déclencheur ni de doublon. Verrous brefs sur
-- notes (23 lignes).
-- Seul écart avec la 046 en plus des noms qualifiés : SET search_path = '' sur la fonction (avertissement Supabase
-- « search_path mutable ») — sans effet fonctionnel : le corps n'utilise que NEW et now() (pg_catalog est toujours
-- consulté, même avec un search_path vide).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE INDEX IF NOT EXISTS idx_notes_owner_id ON public.notes (owner_id);
CREATE INDEX IF NOT EXISTS idx_notes_shop_id  ON public.notes (shop_id);

-- Auto-update updated_at (corps identique à la 046)
CREATE OR REPLACE FUNCTION public.touch_notes_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS notes_updated_at ON public.notes;
CREATE TRIGGER notes_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_notes_updated_at();

-- Fonction de déclencheur : jamais appelée directement (PostgreSQL vérifie le droit d'exécution à la création du
-- déclencheur, pas quand il se déclenche). Comme pour les fonctions de déclencheur de la 179 : aucun droit pour le
-- navigateur ; postgres et service_role gardent les droits par défaut du projet.
REVOKE EXECUTE ON FUNCTION public.touch_notes_updated_at() FROM PUBLIC, anon, authenticated;

COMMIT;
