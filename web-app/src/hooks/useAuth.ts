import { useAuthenticator } from '@aws-amplify/ui-react'
import { useEffect, useState } from 'react'

export interface AuthUser {
  username: string
  email?: string
  attributes?: Record<string, any>
  signInDetails?: Record<string, any>
}

export interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  signOut: () => void
  signIn: (username: string, password: string) => Promise<void>
}

export const useAuth = (): AuthState => {
  const { user, signOut, authStatus } = useAuthenticator((context) => [
    context.user,
    context.signOut,
    context.authStatus,
  ])
  
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Set loading to false once auth status is determined
    if (authStatus !== 'configuring') {
      setIsLoading(false)
    }
  }, [authStatus])

  const isAuthenticated = authStatus === 'authenticated'

  const authUser: AuthUser | null = user ? {
    username: user.username || '',
    email: (user as any).attributes?.email,
    attributes: (user as any).attributes,
    signInDetails: (user as any).signInDetails,
  } : null

  const signIn = async (_username: string, _password: string): Promise<void> => {
    // This would be implemented if we need programmatic sign-in
    // For now, we rely on the Authenticator component
    throw new Error('Programmatic sign-in not implemented. Use Authenticator component.')
  }

  return {
    user: authUser,
    isAuthenticated,
    isLoading,
    signOut,
    signIn,
  }
}

export default useAuth