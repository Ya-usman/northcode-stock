-- ============================================================
-- 158 — Espaces de fichiers : fermeture des règles trop larges (5 oct. 2026)
--
-- Constat (relevé pg_policy du 5 oct., lecture seule) :
--   • « Authenticated can delete product images » et « Authenticated can
--     upload product images », créées À LA MAIN dans le tableau de bord
--     (absentes des migrations) : toute personne connectée — un simple compte
--     gratuit — pouvait supprimer les photos produits de N'IMPORTE QUELLE
--     boutique, ou déposer n'importe quel fichier dans cet espace public.
--     Aucun signe d'exploitation (88 photos référencées, 0 absente).
--     L'application n'en a pas besoin : les photos sont envoyées par
--     /api/products/upload-image avec la clé de service.
--   • Lecture « liste » ouverte à tous (même anonyme) : 141 photos produits et
--     8 logos énumérables. L'affichage n'en a pas besoin : un espace PUBLIC
--     sert ses fichiers par lien public sans passer par ces règles.
--
-- Ce que fait la migration (aucun fichier touché, aucune donnée modifiée) :
--   1. retire les deux écritures ouvertes sur les photos produits ;
--   2. retire les listes publiques (photos produits, reçus, logos) ;
--   3. logos : lecture « liste » réservée au propriétaire de la boutique
--      (nécessaire au remplacement du logo, upsert) ; envoi / remplacement /
--      suppression du logo inchangés (déjà réservés au propriétaire).
--
-- Inchangé : affichage des photos et logos par leur lien public ; espaces
-- privés (temp-pdfs, expense-receipts) gérés par le serveur. Ré-exécutable.
-- ============================================================

-- ── 1. Écritures ouvertes sur les photos produits (créées hors migrations) ──
DROP POLICY IF EXISTS "Authenticated can delete product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload product images" ON storage.objects;

-- ── 2. Listes publiques ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can read product images" ON storage.objects;
DROP POLICY IF EXISTS product_images_read ON storage.objects;
DROP POLICY IF EXISTS receipts_read ON storage.objects;
DROP POLICY IF EXISTS shop_logos_read ON storage.objects;
DROP POLICY IF EXISTS shop_logos_select ON storage.objects;

-- ── 3. Logos : lecture réservée au propriétaire du dossier de la boutique ───
-- Même condition que shop_logos_insert / _update / _delete (migration 014).
DROP POLICY IF EXISTS shop_logos_owner_select ON storage.objects;
CREATE POLICY shop_logos_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'shop-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT shop_members.shop_id::text FROM shop_members
       WHERE shop_members.user_id = auth.uid()
         AND shop_members.is_active = true
         AND shop_members.role = ANY (ARRAY['owner', 'super_admin'])
    )
  );

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT p.polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'storage' ORDER BY 1;
-- Attendu (4 lignes) : shop_logos_delete, shop_logos_insert,
--                      shop_logos_owner_select, shop_logos_update
