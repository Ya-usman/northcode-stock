-- ============================================================
-- Migration 126 : cron_runs — journal d'exécution des tâches cron
-- ============================================================
-- Jusqu'ici, aucune tâche cron (morning-check, evening-summary,
-- low-stock-alert, renewal-check, expiry-alert, orphan-shop-check) ne
-- journalisait sa propre exécution — impossible de savoir depuis l'admin
-- si une tâche tourne encore, a échoué silencieusement, ou n'a jamais été
-- déclenchée (mauvaise config Vercel). Chaque tâche insère désormais une
-- ligne ici à chaque exécution (succès ou échec), lue par la page
-- Admin > Système.

CREATE TABLE IF NOT EXISTS cron_runs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name   text        NOT NULL,
  status     text        NOT NULL CHECK (status IN ('success', 'error')),
  summary    jsonb,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_created ON cron_runs(job_name, created_at DESC);

-- Pas de RLS ouverte au client — accédée uniquement via le client admin
-- (service role), comme les autres tables réservées à /api/admin/* et
-- aux tâches cron elles-mêmes.
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
