'use client'

import { useEffect, useState } from 'react'

function getInitialTheme(): boolean {
  if (typeof window === 'undefined') return false
  const saved = localStorage.getItem('theme')
  if (saved === 'dark') return true
  if (saved === 'light') return false
  // Aucune préférence sauvegardée → suivre le système
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function useTheme() {
  const [isDark, setIsDark] = useState(getInitialTheme)

  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      root.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [isDark])

  return { isDark, setIsDark, toggle: () => setIsDark(v => !v) }
}
