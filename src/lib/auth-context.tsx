'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { createClient, User, AuthError, SupabaseClient } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

function createSupabaseClient(): SupabaseClient | null {
  if (typeof window === 'undefined') {
    return null
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

interface AuthContextType {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabaseRef = useRef<SupabaseClient | null>(null)

  // Initialize Supabase client on mount
  useEffect(() => {
    if (!supabaseRef.current) {
      supabaseRef.current = createSupabaseClient()
    }

    const supabase = supabaseRef.current

    if (!supabase) {
      setLoading(false)
      return
    }

    // Check for existing session
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
      setLoading(false)
    }

    initAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null)

        if (event === 'SIGNED_OUT') {
          router.push('/login')
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = supabaseRef.current
    if (!supabase) {
      return { error: { message: 'Supabase not initialized' } as AuthError }
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (!error) {
      router.push('/')
      router.refresh()
    }

    return { error }
  }, [router])

  const signOut = useCallback(async () => {
    const supabase = supabaseRef.current
    if (!supabase) return

    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }, [router])

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
