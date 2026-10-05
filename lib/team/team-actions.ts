'use client'

// Appels aux routes /api/team/* — module unique partagé par la page Équipe,
// la fiche membre, les fenêtres Affecter / Inviter et l'onglet Équipe d'une
// boutique. Chaque fonction renvoie { ok, error?, data? } sans afficher de
// message : l'appelant choisit le toast.

import { withTimeout } from '@/lib/utils/with-timeout'

export interface TeamActionResult<T = any> { ok: boolean; error?: string; code?: string; data?: T }

async function post<T = any>(url: string, body: unknown): Promise<TeamActionResult<T>> {
  try {
    const res = await withTimeout(fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }), 30_000)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.error, code: json.code, data: json }
    return { ok: true, data: json }
  } catch (err: any) {
    return { ok: false, error: err?.message }
  }
}

export const teamActions = {
  invite: (p: { shop_id: string; email: string; full_name: string; role: string }) =>
    post<{ success: true } | { code: 'member_exists'; user_id: string; full_name: string | null }>('/api/team/invite', p),
  assign: (p: { shop_id: string; user_id: string; role: string }) => post('/api/team/assign', p),
  /** « Retirer de cette boutique » : seule l'affectation est désactivée */
  removeFromShop: (p: { shop_id: string; user_id: string }) => post('/api/team/delete', { shop_id: p.shop_id, employee_id: p.user_id }),
  changeRole: (p: { shop_id: string; member_id: string; role: string }) => post('/api/team/change-role', { shop_id: p.shop_id, member_id: p.member_id, new_role: p.role }),
  /** « Désactiver / Réactiver le compte » (toutes les boutiques du compte) */
  setAccountActive: (p: { shop_id: string; user_id: string; active: boolean }) => post('/api/team/toggle-active', { shop_id: p.shop_id, employee_id: p.user_id, is_active: p.active }),
  resendInvite: (p: { shop_id: string; email: string }) => post('/api/team/resend-invite', p),
}
