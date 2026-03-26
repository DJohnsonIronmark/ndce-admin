'use client'

import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { Search, Filter, Eye, Edit, Trash2 } from 'lucide-react'
import { format } from 'date-fns'

interface Post {
  id: string
  title: string
  content: string
  scheduled_date: string
  scheduled_time: string | null
  platforms: string[]
  status: 'draft' | 'scheduled' | 'posted' | 'failed'
  engagement?: {
    likes: number
    comments: number
    shares: number
  }
}

const mockPosts: Post[] = [
  {
    id: '1',
    title: 'Hip Hop Class Spotlight',
    content: 'Ready to move? Our Hip Hop classes are calling your name!',
    scheduled_date: format(new Date(), 'yyyy-MM-dd'),
    scheduled_time: '10:00',
    platforms: ['facebook', 'instagram'],
    status: 'scheduled',
  },
  {
    id: '2',
    title: 'Spring Recital Announcement',
    content: 'MARK YOUR CALENDARS! Our spring showcase is coming...',
    scheduled_date: format(new Date(), 'yyyy-MM-dd'),
    scheduled_time: '14:00',
    platforms: ['facebook'],
    status: 'draft',
  },
  {
    id: '3',
    title: 'Dance Motivation Monday',
    content: 'Every great dancer was once a beginner...',
    scheduled_date: format(new Date(Date.now() - 86400000), 'yyyy-MM-dd'),
    scheduled_time: '09:00',
    platforms: ['facebook', 'instagram'],
    status: 'posted',
    engagement: { likes: 45, comments: 12, shares: 5 },
  },
]

const statusColors = {
  draft: 'bg-yellow-100 text-yellow-800',
  scheduled: 'bg-blue-100 text-blue-800',
  posted: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

const PlatformIcon = ({ platform }: { platform: string }) => {
  switch (platform) {
    case 'facebook':
      return (
        <svg className="h-4 w-4 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
      )
    case 'instagram':
      return (
        <svg className="h-4 w-4 text-pink-600" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
        </svg>
      )
    default:
      return null
  }
}

export default function PostsPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)

  const filteredPosts = mockPosts.filter((post) => {
    const matchesSearch = post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.content.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || post.status === statusFilter
    return matchesSearch && matchesStatus
  })

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Posts</h1>
            <p className="mt-1 text-sm text-gray-600">
              Manage your scheduled and published posts
            </p>
          </div>
          <a
            href="/ai-generator"
            className="inline-flex items-center rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
          >
            Create New Post
          </a>
        </div>

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search posts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-md border border-gray-300 py-2 pl-10 pr-4 focus:border-purple-500 focus:outline-none focus:ring-purple-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-purple-500"
            >
              <option value="all">All Status</option>
              <option value="draft">Drafts</option>
              <option value="scheduled">Scheduled</option>
              <option value="posted">Posted</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-lg bg-white shadow">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Post
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Platforms
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Scheduled
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Engagement
                </th>
                <th className="relative px-6 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filteredPosts.map((post) => (
                <tr key={post.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="max-w-xs">
                      <p className="font-medium text-gray-900">{post.title}</p>
                      <p className="truncate text-sm text-gray-500">{post.content}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex space-x-1">
                      {post.platforms.map((platform) => (
                        <PlatformIcon key={platform} platform={platform} />
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    <div>
                      {format(new Date(post.scheduled_date), 'MMM d, yyyy')}
                    </div>
                    {post.scheduled_time && (
                      <div className="text-xs text-gray-400">{post.scheduled_time}</div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusColors[post.status]}`}
                    >
                      {post.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {post.engagement ? (
                      <div className="flex space-x-3 text-xs">
                        <span>{post.engagement.likes} likes</span>
                        <span>{post.engagement.comments} comments</span>
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium">
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => setSelectedPost(post)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button className="text-gray-400 hover:text-gray-600">
                        <Edit className="h-4 w-4" />
                      </button>
                      <button className="text-gray-400 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredPosts.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-gray-500">No posts found</p>
            </div>
          )}
        </div>

        {selectedPost && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">{selectedPost.title}</h3>
                <button
                  onClick={() => setSelectedPost(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  &times;
                </button>
              </div>
              <div className="mt-4">
                <p className="whitespace-pre-wrap text-sm text-gray-700">
                  {selectedPost.content}
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">
                <div className="flex space-x-2">
                  {selectedPost.platforms.map((platform) => (
                    <PlatformIcon key={platform} platform={platform} />
                  ))}
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusColors[selectedPost.status]}`}>
                  {selectedPost.status}
                </span>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
