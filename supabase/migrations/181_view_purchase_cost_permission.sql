-- 181 — Permission métier « Voir les prix d'achat et les coûts » (view_purchase_cost) : transition ciblée.
--
-- Contexte (décisions du 25 oct. 2026) : canViewCost = propriétaire OU permission explicite view_purchase_cost
-- (lib/permissions). La déduction « Stock ou Fournisseurs en modification » disparaît. Valeurs par défaut (code) :
-- Responsable et Manager OUI ; Magasinier, Caissier, Observateur NON.
-- Transition « A ciblé » : view_purchase_cost = true est inscrit UNIQUEMENT pour les couples (boutique, rôle) où une
-- personne réelle (membre actif) perdrait sinon son accès actuel au coût. Ailleurs : nouveaux défauts, voulu (y compris
-- les rôles Caissier qui avaient l'ancien droit sans aucun caissier inscrit).
--
-- Couples (UUID de boutique, rôle) relevés le 25 oct. 2026 — jamais de nom comme clé :
--   bdf511df-a716-4c05-b1b2-0634d53e256c  cashier
--   abec3e3f-3e92-4ff0-a374-d2d88f57899b  stock_manager
--   f64a1b6c-f6c6-4f09-90af-d90bcde5f0c0  stock_manager
--
-- Ne touche QUE shops.role_permissions (aucune autre table, aucun droit SQL). L'ancien code ignore cette clé.
-- Garde-fous : la migration s'ARRÊTE (rien n'est écrit) si
--   - une clé view_purchase_cost existe déjà quelque part ;
--   - le recalcul de l'ancienne règle ne donne pas EXACTEMENT ces 3 couples ;
--   - un membre actif GAGNERAIT le coût avec les nouveaux défauts ;
--   - une boutique cible est absente, supprimée, ou a un réglage de forme inattendue ;
--   - après écriture, un seul membre actif n'a pas exactement le même accès qu'avant, ou plus / moins de 3 clés.
-- Retour arrière : supabase/rollbacks/181_view_purchase_cost_permission_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

-- Ancienne règle et nouvelle règle, pour chaque couple (boutique, rôle) ayant au moins un membre actif.
-- Reproduit lib/permissions (resolvePermission + valeurs par défaut) : défauts Stock / Fournisseurs d'avant et
-- défauts view_purchase_cost de la D1. Fonction temporaire de la session, disparaît à la fin de la migration.
CREATE FUNCTION pg_temp.c181_access()
RETURNS TABLE (shop_id uuid, role text, members bigint, old_rule boolean, new_rule boolean)
LANGUAGE sql STABLE AS $$
  WITH d(drole, sv, sw, pv, pw, vpc) AS (VALUES
    ('shop_manager',  true,  true,  true,  true,  true),
    ('manager',       true,  true,  true,  true,  true),
    ('cashier',       false, false, false, false, false),
    ('viewer',        true,  false, true,  false, false),
    ('stock_manager', true,  true,  true,  true,  false)),
  pairs AS (
    SELECT m.shop_id, m.role, count(*) AS members
      FROM public.shop_members m JOIN public.shops s ON s.id = m.shop_id
     WHERE m.is_active AND s.deleted_at IS NULL AND m.role IN ('shop_manager', 'manager', 'cashier', 'viewer', 'stock_manager')
     GROUP BY m.shop_id, m.role),
  c AS (
    SELECT p.shop_id, p.role, p.members, s.role_permissions -> p.role AS own, d.sv, d.sw, d.pv, d.pw, d.vpc,
           coalesce((s.role_permissions -> 'general' ->> 'stock')::boolean, true) AS g_stock,
           coalesce((s.role_permissions -> 'general' ->> 'suppliers')::boolean, true) AS g_sup
      FROM pairs p JOIN public.shops s ON s.id = p.shop_id JOIN d ON d.drole = p.role),
  v AS (
    SELECT c.*,
           g_stock AND CASE WHEN own ? 'stock' THEN coalesce((own ->> 'stock')::boolean, false) ELSE sv END AS v_stock,
           g_sup AND CASE WHEN own ? 'suppliers' THEN coalesce((own ->> 'suppliers')::boolean, false) ELSE pv END AS v_sup
      FROM c)
  SELECT shop_id, role, members,
         (v_stock AND role <> 'viewer' AND CASE WHEN own ? 'stock_write' THEN coalesce((own ->> 'stock_write')::boolean, false)
            ELSE (own ? 'stock' AND coalesce((own ->> 'stock')::boolean, false)) OR sw END)
         OR (v_sup AND role <> 'viewer' AND CASE WHEN own ? 'suppliers_write' THEN coalesce((own ->> 'suppliers_write')::boolean, false)
            ELSE (own ? 'suppliers' AND coalesce((own ->> 'suppliers')::boolean, false)) OR pw END) AS old_rule,
         CASE WHEN own ? 'view_purchase_cost' THEN coalesce((own ->> 'view_purchase_cost')::boolean, false) ELSE vpc END AS new_rule
    FROM v
$$;

DO $$
DECLARE
  targets   constant text[] := ARRAY[
    'abec3e3f-3e92-4ff0-a374-d2d88f57899b:stock_manager',
    'bdf511df-a716-4c05-b1b2-0634d53e256c:cashier',
    'f64a1b6c-f6c6-4f09-90af-d90bcde5f0c0:stock_manager'];
  t         text;
  v_shop    uuid;
  v_role    text;
  v_rp      jsonb;
  v_keys    int;
  v_found   text[];
  v_gain    text[];
  v_diff    text[];
  v_updated int := 0;
  n         int;
BEGIN
  -- 0. Aucune clé view_purchase_cost n'existe encore (181 jamais passée, aucun réglage fait depuis le code)
  SELECT count(*) INTO v_keys
    FROM public.shops s, jsonb_each(CASE WHEN jsonb_typeof(s.role_permissions) = 'object' THEN s.role_permissions ELSE '{}'::jsonb END) e(k, val)
   WHERE jsonb_typeof(e.val) = 'object' AND e.val ? 'view_purchase_cost';
  IF v_keys > 0 THEN
    RAISE EXCEPTION '181 : % réglage(s) view_purchase_cost existent déjà — transition ambiguë, rien n''est écrit', v_keys;
  END IF;

  -- 1. Recalcul : les couples qui PERDRAIENT le coût doivent être exactement les 3 cibles ; personne ne doit en GAGNER
  SELECT array_agg(a.shop_id::text || ':' || a.role ORDER BY a.shop_id::text || ':' || a.role)
    INTO v_found FROM pg_temp.c181_access() a WHERE a.old_rule AND NOT a.new_rule;
  SELECT array_agg(a.shop_id::text || ':' || a.role ORDER BY a.shop_id::text || ':' || a.role)
    INTO v_gain FROM pg_temp.c181_access() a WHERE NOT a.old_rule AND a.new_rule;
  IF v_gain IS NOT NULL THEN
    RAISE EXCEPTION '181 : des membres actifs GAGNERAIENT le coût avec les nouveaux défauts : % — rien n''est écrit', v_gain;
  END IF;
  IF v_found IS DISTINCT FROM targets THEN
    RAISE EXCEPTION '181 : couples à conserver attendus %, trouvés % — les données ont changé depuis l''audit, rien n''est écrit', targets, v_found;
  END IF;

  -- 2. Écriture : view_purchase_cost = true dans le réglage du rôle de chaque boutique cible, rien d'autre
  FOREACH t IN ARRAY targets LOOP
    v_shop := split_part(t, ':', 1)::uuid;
    v_role := split_part(t, ':', 2);
    SELECT s.role_permissions INTO v_rp FROM public.shops s WHERE s.id = v_shop AND s.deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '181 : boutique % absente ou supprimée — rien n''est écrit', v_shop; END IF;
    IF v_rp IS NOT NULL AND jsonb_typeof(v_rp) <> 'object' THEN RAISE EXCEPTION '181 : réglage de % de forme inattendue', v_shop; END IF;
    IF v_rp -> v_role IS NOT NULL AND jsonb_typeof(v_rp -> v_role) <> 'object' THEN RAISE EXCEPTION '181 : réglage % / % de forme inattendue', v_shop, v_role; END IF;
    UPDATE public.shops s
       SET role_permissions = coalesce(v_rp, '{}'::jsonb)
                              || jsonb_build_object(v_role, coalesce(v_rp -> v_role, '{}'::jsonb) || '{"view_purchase_cost": true}'::jsonb)
     WHERE s.id = v_shop;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_updated := v_updated + n;
  END LOOP;
  IF v_updated <> 3 THEN RAISE EXCEPTION '181 : % boutique(s) modifiée(s) au lieu de 3', v_updated; END IF;

  -- 3. Contrôle final : chaque membre actif garde EXACTEMENT son accès d'avant ; exactement 3 clés dans toute la table
  SELECT array_agg(a.shop_id::text || ':' || a.role) INTO v_diff FROM pg_temp.c181_access() a WHERE a.old_rule IS DISTINCT FROM a.new_rule;
  IF v_diff IS NOT NULL THEN RAISE EXCEPTION '181 : accès différent après écriture pour % — annulé', v_diff; END IF;
  SELECT count(*) INTO v_keys
    FROM public.shops s, jsonb_each(CASE WHEN jsonb_typeof(s.role_permissions) = 'object' THEN s.role_permissions ELSE '{}'::jsonb END) e(k, val)
   WHERE jsonb_typeof(e.val) = 'object' AND e.val ? 'view_purchase_cost';
  IF v_keys <> 3 THEN RAISE EXCEPTION '181 : % clé(s) view_purchase_cost au lieu de 3 — annulé', v_keys; END IF;

  RAISE NOTICE '181 : view_purchase_cost inscrit pour 3 couples (boutique, rôle) ; tous les membres actifs gardent leur accès';
END $$;

DROP FUNCTION pg_temp.c181_access();
