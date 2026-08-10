-- ============================================================
-- 103 — Annonce "Nouveautés" : transferts de stock entre boutiques
-- ============================================================

INSERT INTO public.announcements (title, description, icon, badge, badge_color, published_at) VALUES
  (
    'Transferts entre boutiques',
    'Envoyez du stock d''une boutique à l''autre en quelques clics, depuis l''onglet "Transferts" de la page Stock : le stock part immédiatement, l''autre boutique retrouve l''envoi par son numéro de référence et valide ce qu''elle a réellement reçu (avec la raison en cas d''écart).',
    '🔄', 'Nouveau', 'blue',
    now()
  );
