'use client'

import { useEffect, useState } from 'react'

function getInitialTheme(): boolean {
  if (typeof window === 'undefined') return false
  const saved = localStorage.getItem('theme')
  if (saved === 'dark') return true
  if (saved === 'light') return false
  // Aucune préférence manuelle → suivre le système
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function useTheme() {
  const [isDark, setIsDarkState] = useState(false)

  // Read real theme from localStorage after mount to avoid SSR/client hydration mismatch
  useEffect(() => {
    setIsDarkState(getInitialTheme())
  }, [])

  // Applique la classe dark sur <html>
  useEffect(() => {
    const root = document.documentElement
    if (isDark) root.classList.add('dark')
    else root.classList.remove('dark')
  }, [isDark])

  // Suit les changements système en temps réel — mais seulement tant qu'aucune
  // préférence explicite n'a été enregistrée (aucun theme dans localStorage).
  // Un choix manuel (toggle/setIsDark ci-dessous) est définitif : il ne doit
  // plus jamais être écrasé par un changement de mode système ultérieur —
  // sinon "choisir Clair" ne tiendrait que jusqu'au prochain mode sombre
  // auto du téléphone, ce qui n'est le comportement d'aucune app sérieuse.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      if (localStorage.getItem('theme')) return
      setIsDarkState(e.matches)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Choix manuel → sauvegarde la préférence, devient définitif
  const setIsDark = (next: boolean) => {
    localStorage.setItem('theme', next ? 'dark' : 'light')
    setIsDarkState(next)
  }
  const toggle = () => setIsDark(!isDark)

  return { isDark, setIsDark, toggle }
}
