-- ── 070 : Système d'annonces "Nouveautés" ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.announcements (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text        NOT NULL,
  description  text        NOT NULL,
  icon         text        NOT NULL DEFAULT '🚀',
  badge        text        NOT NULL DEFAULT 'Nouveau',   -- Nouveau | Amélioration | Correction
  badge_color  text        NOT NULL DEFAULT 'blue',      -- blue | green | amber | red
  published_at timestamptz NOT NULL DEFAULT now(),
  is_active    boolean     NOT NULL DEFAULT true
);

-- Suivi par utilisateur : date de la dernière annonce vue
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_announcement_at timestamptz;

-- RLS : tout utilisateur connecté peut lire les annonces actives
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "announcements_select_authenticated"
  ON public.announcements FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Seul le service role (super_admin via API) peut insérer / modifier
-- (pas de policy INSERT publique — insertion via Supabase dashboard ou API admin)

-- ── Annonces initiales ────────────────────────────────────────────────────────
INSERT INTO public.announcements (title, description, icon, badge, badge_color, published_at) VALUES
  (
    'Manuel d''utilisation illustré',
    'Un guide complet avec captures d''écran est maintenant disponible dans la page Aide. Retrouvez les 15 sections de l''application documentées pas à pas.',
    '📖', 'Nouveau', 'blue',
    now()
  ),
  (
    'Abonnement trimestriel & annuel',
    'Payez moins en choisissant une période plus longue. -8 % pour le trimestre, -20 % pour l''année — disponible pour tous les pays.',
    '📅', 'Nouveau', 'blue',
    now() - interval '1 day'
  ),
  (
    'Journal des suppressions de dépenses',
    'Le propriétaire peut désormais voir qui a supprimé une dépense et quand, directement depuis la page Dépenses.',
    '🔍', 'Amélioration', 'green',
    now() - interval '2 days'
  );
