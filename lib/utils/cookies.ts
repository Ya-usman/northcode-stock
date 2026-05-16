export function setLocaleCookie(locale: string) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax${secure}`
}
