-- ============================================================
-- 192 : historique des envois de bons de commande par e-mail (validé le 31 oct. 2026)
-- ============================================================
-- « Envoyer par e-mail » expédie le bon au fournisseur depuis StockShop (PDF joint, réponse adressée à la boutique,
-- copie facultative à l'expéditeur). Chaque tentative est gardée ici pour :
--   · le journal du bon (« Envoyé par e-mail à … par … », réussi ou échoué) ;
--   · les limites d'envoi (20 par heure et par personne, 5 par bon et par jour), comptées sur cette table.
-- Le destinataire est TOUJOURS l'e-mail du fournisseur enregistré (jamais une adresse saisie) : il est recopié ici
-- tel qu'utilisé au moment de l'envoi.
--
-- Écritures et lectures : serveur seulement (/api/purchase-orders/email, service role). Aucun accès direct depuis le
-- navigateur. Une trace survit à la suppression du bon (purchase_order_id passe à NULL, la référence reste).
--
-- Additive, ré-exécutable. Retour arrière : DROP TABLE public.purchase_order_emails (aucune autre dépendance).
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.purchase_order_emails (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid        REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  shop_id           uuid        NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  reference         text        NOT NULL,                        -- référence du bon au moment de l'envoi
  recipient         text        NOT NULL,                        -- e-mail du fournisseur utilisé
  reply_to          text,                                        -- adresse de réponse (boutique, sinon expéditeur)
  copy_to           text,                                        -- copie à l'expéditeur, si demandée
  locale            text        NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en', 'ha')),
  status            text        NOT NULL CHECK (status IN ('sent', 'failed')),
  error             text,                                        -- message du prestataire en cas d'échec
  provider_id       text,                                        -- identifiant Resend
  sent_by           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_emails_po     ON public.purchase_order_emails(purchase_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_emails_sender ON public.purchase_order_emails(sent_by, created_at DESC);

ALTER TABLE public.purchase_order_emails ENABLE ROW LEVEL SECURITY;
-- Aucune politique : sans elles, ni anon ni authenticated ne lisent ou n'écrivent (le service role passe outre).
REVOKE ALL ON public.purchase_order_emails FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT count(*) FROM public.purchase_order_emails;                                        -- 0
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'purchase_order_emails';               -- true
-- SELECT has_table_privilege('authenticated', 'public.purchase_order_emails', 'SELECT');     -- false
-- SELECT has_table_privilege('anon', 'public.purchase_order_emails', 'INSERT');              -- false
