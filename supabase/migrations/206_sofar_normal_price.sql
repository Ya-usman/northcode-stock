-- ============================================================
-- 206 : Groupe SOFAR aux prix normaux à la fin de son abonnement — 3 nov. 2026, décision de l'utilisateur
-- ============================================================
-- La 205 garantissait à Groupe SOFAR son ancien prix Pro (7 999 XOF par mois). Décision du 3 nov. 2026 : comme
-- SOFAR BONKANEY, il passe au prix normal en FCFA (Pro 10 000 F par mois) à la fin de son abonnement actuel
-- (1er janvier 2027). Ses limites restent gardées jusqu'à leur date ; seul le prix garanti est retiré.
-- Données seulement, ré-exécutable. Retour arrière : remettre "monthly_price": 7999, "currency": "XOF".
-- ============================================================
SET LOCAL lock_timeout = '5s';

UPDATE public.entities
SET legacy_terms = legacy_terms || '{"monthly_price": null, "currency": null}'::jsonb
WHERE id = 'fcc7b191-dc05-4d84-a937-2a0cf8651703' AND legacy_terms ->> 'monthly_price' IS NOT NULL;

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT name, legacy_terms FROM entities WHERE legacy_terms IS NOT NULL;   -- plus aucun prix garanti pour SOFAR
