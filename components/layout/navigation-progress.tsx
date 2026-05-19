'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

export function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const doneRef = useRef(false)

  // Start bar immediately on any internal link click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest('a')
      if (!link) return
      const href = link.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto')) return
      if (link.target === '_blank') return

      doneRef.current = false
      setVisible(true)
      setWidth(15)

      if (timerRef.current) clearTimeout(timerRef.current)
      // Crawl to 80% while waiting for route change
      timerRef.current = setTimeout(() => !doneRef.current && setWidth(60), 80)
      timerRef.current = setTimeout(() => !doneRef.current && setWidth(80), 400)
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  // Complete when route changes
  useEffect(() => {
    doneRef.current = true
    if (!visible) return
    setWidth(100)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setVisible(false)
      setWidth(0)
    }, 350)
  }, [pathname, searchParams])

  if (!visible && width === 0) return null

  return (
    <div
      className="fixed top-0 left-0 z-[9999] h-[3px] bg-blue-500 shadow-sm shadow-blue-400/50"
      style={{
        width: `${width}%`,
        transition: width === 100
          ? 'width 200ms ease-out'
          : width <= 15
          ? 'width 100ms ease-out'
          : 'width 300ms ease-in-out',
        opacity: visible ? 1 : 0,
        transitionProperty: 'width, opacity',
      }}
    />
  )
}
