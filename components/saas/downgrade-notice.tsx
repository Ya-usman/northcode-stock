'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface DowngradeNoticeProps {
  locale: string
  suspendedShops: number
  suspendedMembers: number
  reactivatedShops: number
  reactivatedMembers: number
}

export function DowngradeNotice({
  locale,
  suspendedShops,
  suspendedMembers,
  reactivatedShops,
  reactivatedMembers,
}: DowngradeNoticeProps) {
  const t = useTranslations('saas')

  const hasSuspensions  = suspendedShops > 0 || suspendedMembers > 0
  const hasReactivations = reactivatedShops > 0 || reactivatedMembers > 0

  if (!hasSuspensions && !hasReactivations) return null

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${hasSuspensions ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800' : 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'}`}>
      <div className="flex items-center gap-2">
        {hasSuspensions
          ? <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
          : <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
        }
        <p className="font-semibold text-sm">{t('downgrade_title')}</p>
      </div>

      <ul className="space-y-1.5 text-sm">
        {suspendedShops > 0 && (
          <li className="text-orange-700 dark:text-orange-400">
            • {t('downgrade_shops_suspended', { count: suspendedShops })}
          </li>
        )}
        {suspendedMembers > 0 && (
          <li className="text-orange-700 dark:text-orange-400">
            • {t('downgrade_members_suspended', { count: suspendedMembers })}
          </li>
        )}
        {reactivatedShops > 0 && (
          <li className="text-green-700 dark:text-green-400">
            • {t('downgrade_shops_reactivated', { count: reactivatedShops })}
          </li>
        )}
        {reactivatedMembers > 0 && (
          <li className="text-green-700 dark:text-green-400">
            • {t('downgrade_members_reactivated', { count: reactivatedMembers })}
          </li>
        )}
      </ul>

      {hasSuspensions && (
        <>
          <p className="text-xs text-muted-foreground">{t('downgrade_info')}</p>
          <Link
            href={`/${locale}/billing`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-stockshop-blue hover:underline"
          >
            {t('upgrade_to_recover')}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </>
      )}
    </div>
  )
}
