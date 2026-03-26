'use client'

import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { Plus, Copy, Edit, Trash2, Check } from 'lucide-react'

interface Template {
  id: string
  name: string
  description: string
  template_content: string
  category: string
  platforms: string[]
  times_used: number
}

const mockTemplates: Template[] = [
  {
    id: '1',
    name: 'Class Spotlight',
    description: 'Highlight a specific dance class',
    template_content: 'Spotlight on our {{dance_style}} class! Join us every {{day}} at {{time}}. Perfect for {{age_group}}. Register now at the link in bio!',
    category: 'class_promo',
    platforms: ['facebook', 'instagram'],
    times_used: 12,
  },
  {
    id: '2',
    name: 'Event Announcement',
    description: 'Announce upcoming events',
    template_content: 'Mark your calendars! {{event_name}} is coming {{date}}! {{description}} Don\'t miss out - registration is open now!',
    category: 'event_announcement',
    platforms: ['facebook', 'instagram'],
    times_used: 8,
  },
  {
    id: '3',
    name: 'Dance Motivation',
    description: 'Inspirational dance content',
    template_content: 'Every dancer was once a beginner. Keep moving, keep growing, keep dancing! See you in class!',
    category: 'motivation',
    platforms: ['facebook', 'instagram'],
    times_used: 25,
  },
  {
    id: '4',
    name: 'Holiday Greeting',
    description: 'Seasonal/holiday posts',
    template_content: 'Happy {{holiday}} from the NDCE family! We\'re grateful for our amazing dance community. See you back in the studio {{return_date}}!',
    category: 'holiday',
    platforms: ['facebook', 'instagram'],
    times_used: 4,
  },
  {
    id: '5',
    name: 'New Student Welcome',
    description: 'Welcome new students',
    template_content: 'Welcome to the NDCE family! We\'re so excited to have new dancers joining us. It\'s never too late to start your dance journey!',
    category: 'welcome',
    platforms: ['facebook', 'instagram'],
    times_used: 15,
  },
]

const categoryColors: Record<string, string> = {
  class_promo: 'bg-blue-100 text-blue-800',
  event_announcement: 'bg-purple-100 text-purple-800',
  motivation: 'bg-green-100 text-green-800',
  holiday: 'bg-red-100 text-red-800',
  welcome: 'bg-yellow-100 text-yellow-800',
}

export default function TemplatesPage() {
  const [templates] = useState<Template[]>(mockTemplates)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyTemplate = (template: Template) => {
    navigator.clipboard.writeText(template.template_content)
    setCopiedId(template.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const highlightPlaceholders = (content: string) => {
    return content.replace(
      /\{\{(\w+)\}\}/g,
      '<span class="rounded bg-purple-100 px-1 text-purple-700">{{$1}}</span>'
    )
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Content Templates</h1>
            <p className="mt-1 text-sm text-gray-600">
              Reusable templates for common post types
            </p>
          </div>
          <button className="inline-flex items-center rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
            <Plus className="mr-2 h-4 w-4" />
            Create Template
          </button>
        </div>

        <div className="mt-6 rounded-lg bg-blue-50 p-4">
          <h3 className="text-sm font-medium text-blue-800">Using Templates</h3>
          <p className="mt-1 text-sm text-blue-700">
            Templates use placeholders like <code className="rounded bg-blue-100 px-1">{'{{dance_style}}'}</code> that get replaced with actual values.
            Use them as starting points and customize for each post.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {templates.map((template) => (
            <div
              key={template.id}
              className="overflow-hidden rounded-lg bg-white shadow"
            >
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${categoryColors[template.category] || 'bg-gray-100 text-gray-800'}`}
                    >
                      {template.category.replace('_', ' ')}
                    </span>
                    <h3 className="mt-2 text-lg font-semibold text-gray-900">
                      {template.name}
                    </h3>
                    <p className="text-sm text-gray-500">{template.description}</p>
                  </div>
                  <div className="flex space-x-1">
                    <button
                      onClick={() => copyTemplate(template)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      {copiedId === template.id ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                    <button className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                      <Edit className="h-4 w-4" />
                    </button>
                    <button className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p
                    className="text-sm text-gray-700"
                    dangerouslySetInnerHTML={{
                      __html: highlightPlaceholders(template.template_content),
                    }}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
                  <div className="flex space-x-2">
                    {template.platforms.map((platform) => (
                      <span
                        key={platform}
                        className="rounded bg-gray-100 px-2 py-1 text-xs capitalize"
                      >
                        {platform}
                      </span>
                    ))}
                  </div>
                  <span>Used {template.times_used} times</span>
                </div>

                <button className="mt-4 w-full rounded-md bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100">
                  Use This Template
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
