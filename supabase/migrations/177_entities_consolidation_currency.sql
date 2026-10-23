-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 177 — Devise de consolidation de l'entreprise (lot 5, décision D1)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Sert UNIQUEMENT à consolider les rapports quand les boutiques d'une entreprise utilisent plusieurs devises
-- (montants d'origine toujours affichés, consolidé « ≈ » en complément). Ne change JAMAIS la devise opérationnelle
-- des boutiques (shops.currency). Une entreprise dont toutes les boutiques ont la même devise n'est jamais convertie.
--
-- Valeur par défaut initiale (décisions du 23 oct. 2026) — le propriétaire peut ensuite la modifier :
--   1. toutes les boutiques existantes (non supprimées) de l'entreprise ont UNE seule devise → cette devise ;
--   2. sinon devise du pays de l'entreprise (entities.country), table identique à lib/saas/countries.ts (52 pays) ;
--   3. (pas de « boutique principale » en base : règle sans objet) ;
--   4. sinon devise de la PREMIÈRE boutique non supprimée : created_at croissant, puis id croissant (déterministe) ;
--   jamais une valeur venant d'une boutique « active » de l'interface ;
--   si une entreprise reste sans valeur, la migration S'ARRÊTE (aucune valeur par défaut cachée).
-- Nouvelles entreprises (créées par le déclencheur shops_assign_entity, à la création de leur première boutique) :
-- cette boutique est alors leur seule boutique → règle 1 → devise de cette boutique.
-- Retour arrière : supabase/drafts/177_entities_consolidation_currency_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- 1. Colonne (d'abord facultative, le temps du remplissage)
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS consolidation_currency text;

-- 2. Remplissage des entreprises existantes
WITH active_shops AS (
  SELECT s.entity_id, s.currency, s.created_at, s.id FROM public.shops s WHERE s.deleted_at IS NULL
),
single_currency AS (                       -- règle 1 : une seule devise parmi les boutiques existantes
  SELECT entity_id, min(currency) AS currency FROM active_shops GROUP BY entity_id HAVING count(DISTINCT currency) = 1
),
country_currency(country, currency) AS (   -- règle 2 : table identique à lib/saas/countries.ts
  VALUES
    ('AT','EUR'), ('BE','EUR'), ('BF','XOF'), ('BG','EUR'), ('BJ','XOF'), ('CA','CAD'), ('CD','CDF'), ('CF','XAF'),
    ('CG','XAF'), ('CI','XOF'), ('CM','XAF'), ('CV','CVE'), ('CY','EUR'), ('CZ','CZK'), ('DE','EUR'), ('DK','DKK'),
    ('EE','EUR'), ('ES','EUR'), ('FI','EUR'), ('FR','EUR'), ('GA','XAF'), ('GH','GHS'), ('GM','GMD'), ('GN','GNF'),
    ('GQ','XAF'), ('GR','EUR'), ('GW','XOF'), ('HR','EUR'), ('HU','HUF'), ('IE','EUR'), ('IT','EUR'), ('LR','LRD'),
    ('LT','EUR'), ('LU','EUR'), ('LV','EUR'), ('ML','XOF'), ('MR','MRU'), ('MT','EUR'), ('NE','XOF'), ('NG','NGN'),
    ('NL','EUR'), ('PL','PLN'), ('PT','EUR'), ('RO','RON'), ('SE','SEK'), ('SI','EUR'), ('SK','EUR'), ('SL','SLE'),
    ('SN','XOF'), ('TD','XAF'), ('TG','XOF'), ('US','USD')
),
first_shop AS (                            -- règle 4 : première boutique, ordre déterministe
  SELECT DISTINCT ON (entity_id) entity_id, currency FROM active_shops ORDER BY entity_id, created_at ASC NULLS LAST, id ASC
)
UPDATE public.entities e
SET consolidation_currency = COALESCE(sc.currency, cc.currency, fs.currency)
FROM public.entities e2
LEFT JOIN single_currency sc ON sc.entity_id = e2.id
LEFT JOIN country_currency cc ON cc.country = upper(btrim(e2.country))
LEFT JOIN first_shop fs ON fs.entity_id = e2.id
WHERE e2.id = e.id AND e.consolidation_currency IS NULL;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.entities WHERE consolidation_currency IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '177 : % entreprise(s) sans devise de consolidation déterminable — migration arrêtée', n;
  END IF;
END $$;

-- 3. Validation ISO 4217 : mêmes devises que les boutiques (shops_currency_supported, migration 142), puis obligatoire
ALTER TABLE public.entities ADD CONSTRAINT entities_consolidation_currency_supported CHECK (consolidation_currency = ANY (ARRAY[
  'NGN','XOF','XAF','GHS','GNF','GMD','SLE','LRD','CVE','MRU','CDF','EUR','USD','CAD','CZK','DKK','HUF','PLN','RON','SEK']));
ALTER TABLE public.entities ALTER COLUMN consolidation_currency SET NOT NULL;

COMMENT ON COLUMN public.entities.consolidation_currency IS
  'Devise de consolidation des rapports quand les boutiques utilisent plusieurs devises (montants d''origine toujours affichés). Ne change pas shops.currency.';

-- 4. Nouvelles entreprises : devise de la boutique qui les crée (leur seule boutique — règle 1)
--    Seule différence avec la version de la migration 155 : la colonne consolidation_currency dans l'INSERT.
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
    INSERT INTO entities (name, owner_user_id, country, billing_contact_name, billing_email, billing_country, is_internal,
                          consolidation_currency)
    VALUES (left(btrim(NEW.name), 120), NEW.owner_id, COALESCE(v_country, NEW.country),
            v_name, v_email, COALESCE(NEW.billing_country, NEW.country), COALESCE(v_internal, false),
            NEW.currency)
    RETURNING id INTO v_entity;
    INSERT INTO entity_members (entity_id, user_id, role) VALUES (v_entity, NEW.owner_id, 'owner')
    ON CONFLICT (entity_id, user_id) DO UPDATE SET role = 'owner', is_active = true;
  END IF;
  NEW.entity_id := v_entity;
  RETURN NEW;
END $$;
