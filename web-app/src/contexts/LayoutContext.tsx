import React, { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'

interface LayoutState {
  navigationOpen: boolean
  isMobile: boolean
  contentMaxWidth: number
}

interface LayoutContextType extends LayoutState {
  setNavigationOpen: (open: boolean) => void
  toggleNavigation: () => void
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined)

interface LayoutProviderProps {
  children: ReactNode
}

export const LayoutProvider: React.FC<LayoutProviderProps> = ({ children }) => {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [contentMaxWidth] = useState(Number.MAX_VALUE)

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      
      // Auto-close navigation on mobile
      if (mobile && navigationOpen) {
        setNavigationOpen(false)
      }
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => window.removeEventListener('resize', checkMobile)
  }, [navigationOpen])

  const toggleNavigation = () => {
    setNavigationOpen(!navigationOpen)
  }

  const value: LayoutContextType = {
    navigationOpen,
    isMobile,
    contentMaxWidth,
    setNavigationOpen,
    toggleNavigation,
  }

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  )
}

export const useLayout = (): LayoutContextType => {
  const context = useContext(LayoutContext)
  if (context === undefined) {
    throw new Error('useLayout must be used within a LayoutProvider')
  }
  return context
}

export default LayoutContext