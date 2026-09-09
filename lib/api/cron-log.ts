import { createAdminClient } from '@/lib/supabase/server'

/**
 * Journalise l'exécution d'une tâche cron dans `cron_runs` (migration 126)
 * — lu par la page Admin > Système pour savoir si une tâche tourne encore,
 * a échoué silencieusement, ou n'a jamais été déclenchée. Ne doit jamais
 * faire échouer la tâche elle-même : erreurs avalées silencieusement.
 */
export async function logCronRun(
  jobName: string,
  status: 'success' | 'error',
  summary?: Record<string, any>,
  error?: string,
): Promise<void> {
  try {
    const admin = await createAdminClient() as any
    await admin.from('cron_runs').insert({ job_name: jobName, status, summary: summary ?? null, error: error ?? null })
  } catch {
    // Ne jamais bloquer la tâche réelle pour un problème de journalisation
  }
}
