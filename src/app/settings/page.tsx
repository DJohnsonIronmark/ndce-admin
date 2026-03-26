'use client'

import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { Link2, Check, AlertCircle, RefreshCw } from 'lucide-react'

interface PlatformConnection {
  id: string
  platform: string
  connected: boolean
  username?: string
  lastVerified?: string
  error?: string
}

const mockConnections: PlatformConnection[] = [
  {
    id: '1',
    platform: 'facebook',
    connected: false,
  },
  {
    id: '2',
    platform: 'instagram',
    connected: false,
  },
]

export default function SettingsPage() {
  const [connections] = useState<PlatformConnection[]>(mockConnections)
  const [supabaseUrl, setSupabaseUrl] = useState('')
  const [supabaseKey, setSupabaseKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')

  const PlatformIcon = ({ platform }: { platform: string }) => {
    switch (platform) {
      case 'facebook':
        return (
          <svg className="h-6 w-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
        )
      case 'instagram':
        return (
          <svg className="h-6 w-6 text-pink-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
          </svg>
        )
      default:
        return <Link2 className="h-6 w-6 text-gray-600" />
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-600">
            Configure your admin panel and connect social accounts
          </p>
        </div>

        <div className="mt-8 space-y-8">
          {/* Database Connection */}
          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-medium text-gray-900">Database Connection</h2>
            <p className="mt-1 text-sm text-gray-500">
              Connect to Supabase to store your content and posts
            </p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Supabase URL
                </label>
                <input
                  type="text"
                  value={supabaseUrl}
                  onChange={(e) => setSupabaseUrl(e.target.value)}
                  placeholder="https://your-project.supabase.co"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Supabase Anon Key
                </label>
                <input
                  type="password"
                  value={supabaseKey}
                  onChange={(e) => setSupabaseKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1..."
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                />
              </div>

              <div className="rounded-md bg-yellow-50 p-4">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-yellow-400" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-yellow-800">
                      Environment Variables Recommended
                    </h3>
                    <p className="mt-1 text-sm text-yellow-700">
                      For production, set these values in your <code className="rounded bg-yellow-100 px-1">.env.local</code> file instead of entering them here.
                    </p>
                  </div>
                </div>
              </div>

              <button className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
                Test Connection
              </button>
            </div>
          </div>

          {/* AI Configuration */}
          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-medium text-gray-900">AI Content Generation</h2>
            <p className="mt-1 text-sm text-gray-500">
              Configure AI for generating social media content
            </p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  OpenAI API Key (or Anthropic)
                </label>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-..."
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Supports OpenAI (OPENAI_API_KEY) or Anthropic (ANTHROPIC_API_KEY)
                </p>
              </div>

              <button className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
                Save API Key
              </button>
            </div>
          </div>

          {/* Social Media Connections */}
          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-medium text-gray-900">Social Media Accounts</h2>
            <p className="mt-1 text-sm text-gray-500">
              Connect your social media accounts to enable posting
            </p>

            <div className="mt-6 space-y-4">
              {connections.map((connection) => (
                <div
                  key={connection.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 p-4"
                >
                  <div className="flex items-center space-x-4">
                    <PlatformIcon platform={connection.platform} />
                    <div>
                      <h3 className="font-medium capitalize text-gray-900">
                        {connection.platform}
                      </h3>
                      {connection.connected ? (
                        <p className="text-sm text-gray-500">
                          Connected as @{connection.username}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-500">Not connected</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {connection.connected ? (
                      <>
                        <span className="flex items-center text-sm text-green-600">
                          <Check className="mr-1 h-4 w-4" />
                          Connected
                        </span>
                        <button className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                          <RefreshCw className="h-4 w-4" />
                        </button>
                        <button className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <button className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <div className="rounded-md bg-blue-50 p-4">
                <h3 className="text-sm font-medium text-blue-800">Coming Soon</h3>
                <p className="mt-1 text-sm text-blue-700">
                  Social media integration requires setting up OAuth apps with Facebook/Meta and Instagram.
                  For now, use the content generator to create posts and copy them manually.
                </p>
              </div>
            </div>
          </div>

          {/* Studio Information */}
          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-medium text-gray-900">Studio Information</h2>
            <p className="mt-1 text-sm text-gray-500">
              Default information used in content generation
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Studio Name
                </label>
                <input
                  type="text"
                  defaultValue="Nicole's Dance Center Elite"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Short Name / Handle
                </label>
                <input
                  type="text"
                  defaultValue="NDCE"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">
                  Default Hashtags
                </label>
                <input
                  type="text"
                  defaultValue="#NicolesDanceCenterElite #NDCE #DanceStudio"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                />
              </div>
            </div>

            <button className="mt-4 rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
              Save Settings
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
