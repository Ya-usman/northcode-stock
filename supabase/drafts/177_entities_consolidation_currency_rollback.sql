-- Retour arrière de 177 (devise de consolidation) — à n’exécuter QUE sur décision explicite (177 appliquée le 23 oct. 2026)
-- Restaure shops_assign_entity EXACTEMENT comme la migration 155 (corps identique à la base le 23 oct. 2026 — md5 du corps sans retours chariot :
-- 652b21e8987991e2df3ba1ce10bfc7c8), puis retire la contrainte et la colonne.
-- Aucune donnée opérationnelle touchée (shops.currency inchangée).

BEGIN;

CREATE OR REPLACE FUNCTION shops_assign_entity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entity uuid; v_email text; v_name text; v_country text; v_internal boolean;
BEGIN
  IF NEW.entity_id IS NOT NULL OR NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_entity FROM entities WHERE owner_user_id = NEW.owner_id ORDER BY created_at LIMIT 1;
  IF v_entity IS NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = NEW.owner_id;
    SELECT NULLIF(btrim(full_name), ''), country, COALESCE(is_internal, false)
      INTO v_name, v_country, v_internal
      FROM profiles WHERE id = NEW.owner_id;
    -- Abonnement : « trial » par défaut (colonne) ; dates d'essai écrites par
    -- le serveur juste après (inscription, compte Google, création admin).
    INSERT INTO entities (name, owner_user_id, country, billing_contact_name, billing_email, billing_country, is_internal)
    VALUES (left(btrim(NEW.name), 120), NEW.owner_id, COALESCE(v_country, NEW.country),
            v_name, v_email, COALESCE(NEW.billing_country, NEW.country), COALESCE(v_internal, false))
    RETURNING id INTO v_entity;
    INSERT INTO entity_members (entity_id, user_id, role) VALUES (v_entity, NEW.owner_id, 'owner')
    ON CONFLICT (entity_id, user_id) DO UPDATE SET role = 'owner', is_active = true;
  END IF;
  NEW.entity_id := v_entity;
  RETURN NEW;
END $$;

ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_consolidation_currency_supported;
ALTER TABLE public.entities DROP COLUMN IF EXISTS consolidation_currency;

COMMIT;
