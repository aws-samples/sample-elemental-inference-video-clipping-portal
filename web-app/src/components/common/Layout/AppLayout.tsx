import React from 'react'
import { AppLayout as CloudscapeAppLayout } from '@cloudscape-design/components'
import { useAuthenticator } from '@aws-amplify/ui-react'
import { LayoutProvider, useLayout } from '../../../contexts/LayoutContext'
import { Navigation, TopNavigation } from '../Navigation'
import {Footer} from "../Footer";

interface AppLayoutProps {
  children: React.ReactNode
}

const AppLayoutContent: React.FC<AppLayoutProps> = ({ children }) => {
  const { user, signOut } = useAuthenticator((context) => [context.user, context.signOut])
  const { navigationOpen, setNavigationOpen, contentMaxWidth } = useLayout()

  return (
    <div style={{ position: "relative"}}>
      <TopNavigation user={user} signOut={signOut} />
        <CloudscapeAppLayout
          disableContentPaddings
          headerSelector="#top-nav"
          navigationOpen={navigationOpen}
          onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
          navigation={<Navigation />}
          content={
            <div style={{ height: "100vh", overflowY: "auto", marginTop: "3.2em", paddingBottom: "3em" }}>
              {children}
            </div>
          }
          toolsHide={true}
          contentType="default"
          maxContentWidth={contentMaxWidth}
          className={"app-layout"}
        />
      <Footer />
    </div>
  )
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <LayoutProvider>
      <AppLayoutContent>{children}</AppLayoutContent>
    </LayoutProvider>
  )
}

export default AppLayout