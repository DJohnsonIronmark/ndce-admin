import Sidebar from '@/components/Sidebar'
import { CalendarDays, MessageSquare, Sparkles, TrendingUp } from 'lucide-react'

const stats = [
  { name: 'Scheduled Posts', value: '12', icon: CalendarDays, color: 'bg-blue-500' },
  { name: 'Posts This Week', value: '8', icon: MessageSquare, color: 'bg-green-500' },
  { name: 'AI Suggestions', value: '5', icon: Sparkles, color: 'bg-purple-500' },
  { name: 'Engagement Rate', value: '4.2%', icon: TrendingUp, color: 'bg-orange-500' },
]

export default function Dashboard() {
  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Welcome to the NDCE content management system
        </p>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.name}
              className="overflow-hidden rounded-lg bg-white px-4 py-5 shadow"
            >
              <div className="flex items-center">
                <div className={`rounded-md p-3 ${stat.color}`}>
                  <stat.icon className="h-6 w-6 text-white" />
                </div>
                <div className="ml-5">
                  <p className="text-sm font-medium text-gray-500">{stat.name}</p>
                  <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-medium text-gray-900">Upcoming Posts</h2>
            <p className="mt-2 text-sm text-gray-500">
              Connect Supabase to view scheduled posts
            </p>
            <div className="mt-4 rounded-md bg-gray-50 p-4">
              <p className="text-sm text-gray-600">
                Set up your <code className="rounded bg-gray-200 px-1">.env.local</code> file
                with Supabase credentials to get started.
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-medium text-gray-900">AI Content Suggestions</h2>
            <p className="mt-2 text-sm text-gray-500">
              Generate content ideas with AI
            </p>
            <a
              href="/ai-generator"
              className="mt-4 inline-flex items-center rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Content
            </a>
          </div>
        </div>

        <div className="mt-8 rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-medium text-gray-900">Quick Setup Guide</h2>
          <ol className="mt-4 list-inside list-decimal space-y-2 text-sm text-gray-600">
            <li>Run the migration in <code className="rounded bg-gray-100 px-1">supabase/migrations/001_content_calendar.sql</code></li>
            <li>Copy <code className="rounded bg-gray-100 px-1">.env.local.example</code> to <code className="rounded bg-gray-100 px-1">.env.local</code></li>
            <li>Add your Supabase URL and anon key</li>
            <li>Add your OpenAI or Anthropic API key for AI content generation</li>
            <li>Connect your social media accounts in Settings</li>
          </ol>
        </div>
      </main>
    </div>
  )
}
