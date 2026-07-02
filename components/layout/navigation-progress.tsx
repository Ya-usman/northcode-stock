'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

export function NavigationProgress() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const doneRef = useRef(false)
  // Prevents double-start when a <Link> click fires both the click handler
  // and the history.pushState patch simultaneously.
  const runningRef = useRef(false)

  const startBar = () => {
    if (runningRef.current) return
    runningRef.current = true
    doneRef.current = false
    setVisible(true)
    setWidth(15)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => !doneRef.current && setWidth(60), 80)
    timerRef.current = setTimeout(() => !doneRef.current && setWidth(80), 400)
    timerRef.current = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true
        runningRef.current = false
        setVisible(false)
        setWidth(0)
      }
    }, 4000)
  }

  // Start bar on any internal <a> click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest('a')
      if (!link) return
      const href = link.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto') || href.startsWith('blob:') || href.startsWith('data:')) return
      if (link.target === '_blank') return
      const targetPath = href.split('?')[0].split('#')[0]
      if (targetPath === window.location.pathname) return
      startBar()
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  // Also start bar on programmatic router.push() / router.replace() navigations.
  // Next.js App Router uses history.pushState/replaceState internally.
  useEffect(() => {
    const origPush    = history.pushState.bind(history)
    const origReplace = history.replaceState.bind(history)

    history.pushState = (...args) => {
      startBar()
      return origPush(...args)
    }
    history.replaceState = (...args) => {
      startBar()
      return origReplace(...args)
    }

    return () => {
      history.pushState    = origPush
      history.replaceState = origReplace
    }
  }, [])

  // Complete when route changes
  useEffect(() => {
    doneRef.current = true
    runningRef.current = false
    if (!visible) return
    setWidth(100)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setVisible(false)
      setWidth(0)
    }, 350)
  }, [pathname])

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
