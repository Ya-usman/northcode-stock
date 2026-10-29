-- Retour arrière de 187 : retire la colonne dismissed_at (les messages masqués réapparaissent dans la cloche).
-- À n'exécuter qu'après avoir remis en ligne une version de l'application qui ne lit plus cette colonne.
ALTER TABLE public.admin_notifications DROP COLUMN IF EXISTS dismissed_at;
NOTIFY pgrst, 'reload schema';
