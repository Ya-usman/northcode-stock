export function setLocaleCookie(locale: string) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax${secure}`
}

export function getLocaleCookie(): string | null {
  if (typeof document === 'undefined') return null
  return document.cookie.match(/NEXT_LOCALE=([^;]+)/)?.[1] ?? null
}
