-- Retour arrière de 181_view_purchase_cost_permission.sql — à lancer seulement sur décision explicite.
-- Retire view_purchase_cost des 3 couples (boutique, rôle) inscrits par la 181, et rien d'autre. Si le réglage du
-- rôle devient vide, il est retiré ; si le réglage de la boutique devient vide, il redevient NULL (état d'avant
-- pour les deux boutiques Bastos). Une valeur que le propriétaire aurait changée depuis (false) est laissée telle quelle.
-- ATTENTION : avec le NOUVEAU code (canViewCost = propriétaire OU view_purchase_cost), ces 3 rôles perdent le coût ;
-- ce retour arrière n'a de sens qu'avec le retour à l'ancien code. Il ne touche pas supabase_migrations : après
-- l'avoir lancé, enregistrer l'état (« supabase migration repair --status reverted 181 ») sur décision.
BEGIN;

DO $$
DECLARE
  targets constant text[] := ARRAY[
    'abec3e3f-3e92-4ff0-a374-d2d88f57899b:stock_manager',
    'bdf511df-a716-4c05-b1b2-0634d53e256c:cashier',
    'f64a1b6c-f6c6-4f09-90af-d90bcde5f0c0:stock_manager'];
  t text; v_shop uuid; v_role text; v_rp jsonb; v_new jsonb;
BEGIN
  FOREACH t IN ARRAY targets LOOP
    v_shop := split_part(t, ':', 1)::uuid;
    v_role := split_part(t, ':', 2);
    SELECT role_permissions INTO v_rp FROM public.shops WHERE id = v_shop FOR UPDATE;
    IF v_rp -> v_role ->> 'view_purchase_cost' IS DISTINCT FROM 'true' THEN
      RAISE NOTICE 'rollback 181 : % / % — valeur absente ou modifiée depuis, laissée telle quelle', v_shop, v_role;
      CONTINUE;
    END IF;
    v_new := v_rp #- ARRAY[v_role, 'view_purchase_cost'];
    IF v_new -> v_role = '{}'::jsonb THEN v_new := v_new - v_role; END IF;
    UPDATE public.shops SET role_permissions = CASE WHEN v_new = '{}'::jsonb THEN NULL ELSE v_new END WHERE id = v_shop;
  END LOOP;
END $$;

COMMIT;
