'use client'

import { useEffect } from 'react'

export function SplashRemover() {
  useEffect(() => {
    const el = document.getElementById('app-splash')
    if (el) {
      el.style.opacity = '0'
      el.style.transition = 'opacity 0.15s ease'
      setTimeout(() => el.remove(), 160)
    }
  }, [])
  return null
}
