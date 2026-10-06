-- ============================================================
-- 166 — CORRECTIF URGENT : encaissement impossible (6 oct. 2026)
--
-- Symptôme : « function gen_random_bytes(integer) does not exist » au clic
-- sur « Valider » ; aucune vente enregistrée depuis l'application de la 159
-- (en ligne ET synchronisation des ventes hors ligne).
--
-- Cause : la 159 a recréé complete_sale avec « SET search_path = public » et
-- lui fait appeler gen_receipt_token() directement. Ce générateur (migration
-- 150) appelle gen_random_bytes SANS préfixe ; or pgcrypto est installé dans
-- le schéma « extensions », absent de ce search_path → fonction introuvable.
--
-- Correctif : le générateur nomme la fonction avec son schéma et fixe son
-- propre search_path → il marche quel que soit l'appelant (complete_sale,
-- valeur par défaut de la colonne, futur code). Même résultat qu'avant
-- (16 caractères [a-z0-9]). Aucune donnée modifiée. Ré-exécutable.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION gen_receipt_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public, extensions
AS $$
  SELECT string_agg(
    substr('abcdefghijklmnopqrstuvwxyz0123456789', (get_byte(extensions.gen_random_bytes(1), 0) % 36) + 1, 1),
    ''
  )
  FROM generate_series(1, 16);
$$;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT gen_receipt_token();                          -- 16 caractères [a-z0-9]
-- SET LOCAL search_path = public; SELECT gen_receipt_token();  -- marche aussi (c'était l'erreur)
