import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SideNavigation } from '@cloudscape-design/components'
import { useLayout } from '../../../contexts/LayoutContext'
import type { NavigationItem } from '../../../types'

const Navigation: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { setNavigationOpen } = useLayout()

  const navigationItems: NavigationItem[] = [
    { text: 'Channels', href: '/channels', type: 'link' },
    { text: 'Events', href: '/', type: 'link' },
    { text: 'Video Editor', href: '/video-editor', type: 'link' },
    { text: 'Documentation', href: '/docs', type: 'link' },
  ]

  const handleFollow = (event: CustomEvent) => {
    event.preventDefault()
    const href = event.detail.href
    if (href && href !== '#') {
      navigate(href)
      setNavigationOpen(false)
    }
  }

  return (
    <SideNavigation
      header={{
        href: '/',
        text: 'Clipping Tools',
      }}
      activeHref={location.pathname}
      onFollow={handleFollow}
      items={navigationItems.map(item => {
        if (item.type === 'section') {
          return {
            type: 'section' as const,
            text: item.text,
            items: [], // Section items require an items array
          }
        }
        return {
          type: 'link' as const,
          text: item.text,
          href: item.href,
        }
      })}
    />
  )
}

export default Navigation