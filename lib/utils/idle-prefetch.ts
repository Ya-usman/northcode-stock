import { getPageCache } from '@/lib/offline/page-cache'

export interface PrefetchTask {
  cacheKey: string
  run: () => Promise<void>
}

/**
 * Warms a handful of pages' read caches in the background, one at a time,
 * during browser idle time — so navigating to them right after rarely shows
 * a loading skeleton. Deliberately NOT "prefetch every page": run one task at
 * a time (never in parallel) so this never competes for bandwidth with the
 * current page's own critical fetch or with syncing pending offline writes,
 * and skip entirely when offline or when the browser signals Data Saver
 * (Network Information API — common on Android, the target market here).
 * A task whose cache is already warm is skipped without even being scheduled.
 */
export function runIdlePrefetch(tasks: PrefetchTask[], isOnline: boolean) {
  if (!isOnline || typeof window === 'undefined') return
  if ((navigator as any).connection?.saveData) return

  const schedule = (fn: () => void) => {
    if ('requestIdleCallback' in window) (window as any).requestIdleCallback(fn, { timeout: 5_000 })
    else setTimeout(fn, 1_500)
  }

  let i = 0
  const runNext = () => {
    if (i >= tasks.length) return
    const task = tasks[i++]
    if (getPageCache(task.cacheKey)) { runNext(); return }
    task.run().catch(() => {}).finally(() => schedule(runNext))
  }
  schedule(runNext)
}
