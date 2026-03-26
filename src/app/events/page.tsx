'use client'

import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { Plus, Calendar, Clock, MapPin, Users, Edit, Trash2 } from 'lucide-react'
import { format, addDays } from 'date-fns'

interface Event {
  id: string
  title: string
  description: string
  event_date: string
  start_time: string
  end_time: string
  event_type: string
  dance_style: string
  age_group: string
  location: string
  is_featured: boolean
}

const mockEvents: Event[] = [
  {
    id: '1',
    title: 'Hip Hop Workshop',
    description: 'Learn the latest hip hop moves with our guest instructor!',
    event_date: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
    start_time: '14:00',
    end_time: '16:00',
    event_type: 'workshop',
    dance_style: 'Hip Hop',
    age_group: 'Teens (13-17)',
    location: 'Studio A',
    is_featured: true,
  },
  {
    id: '2',
    title: 'Spring Recital 2026',
    description: 'Join us for our annual spring recital showcasing all our talented dancers!',
    event_date: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
    start_time: '18:00',
    end_time: '21:00',
    event_type: 'recital',
    dance_style: 'All Styles',
    age_group: 'All Ages',
    location: 'Community Theater',
    is_featured: true,
  },
  {
    id: '3',
    title: 'Ballet Basics',
    description: 'Weekly ballet class for beginners',
    event_date: format(new Date(), 'yyyy-MM-dd'),
    start_time: '16:00',
    end_time: '17:00',
    event_type: 'class',
    dance_style: 'Ballet',
    age_group: 'Kids (5-8)',
    location: 'Studio B',
    is_featured: false,
  },
]

const eventTypeColors: Record<string, string> = {
  class: 'bg-blue-100 text-blue-800',
  workshop: 'bg-purple-100 text-purple-800',
  recital: 'bg-pink-100 text-pink-800',
  competition: 'bg-orange-100 text-orange-800',
  camp: 'bg-green-100 text-green-800',
  open_house: 'bg-yellow-100 text-yellow-800',
}

export default function EventsPage() {
  const [events] = useState<Event[]>(mockEvents)
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Events</h1>
            <p className="mt-1 text-sm text-gray-600">
              Manage classes, workshops, and recitals
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Event
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {events.map((event) => (
            <div
              key={event.id}
              className="overflow-hidden rounded-lg bg-white shadow"
            >
              {event.is_featured && (
                <div className="bg-gradient-to-r from-purple-600 to-pink-500 px-4 py-1 text-xs font-medium text-white">
                  Featured Event
                </div>
              )}
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${eventTypeColors[event.event_type] || 'bg-gray-100 text-gray-800'}`}
                    >
                      {event.event_type}
                    </span>
                    <h3 className="mt-2 text-lg font-semibold text-gray-900">
                      {event.title}
                    </h3>
                  </div>
                  <div className="flex space-x-1">
                    <button className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                      <Edit className="h-4 w-4" />
                    </button>
                    <button className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                  {event.description}
                </p>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center text-sm text-gray-500">
                    <Calendar className="mr-2 h-4 w-4" />
                    {format(new Date(event.event_date), 'EEEE, MMMM d, yyyy')}
                  </div>
                  <div className="flex items-center text-sm text-gray-500">
                    <Clock className="mr-2 h-4 w-4" />
                    {event.start_time} - {event.end_time}
                  </div>
                  <div className="flex items-center text-sm text-gray-500">
                    <MapPin className="mr-2 h-4 w-4" />
                    {event.location}
                  </div>
                  <div className="flex items-center text-sm text-gray-500">
                    <Users className="mr-2 h-4 w-4" />
                    {event.dance_style} | {event.age_group}
                  </div>
                </div>

                <div className="mt-4 flex space-x-2">
                  <button className="flex-1 rounded-md bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100">
                    Create Post
                  </button>
                  <button className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    View Details
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Add New Event</h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  &times;
                </button>
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Connect Supabase to enable event creation. See setup guide on the dashboard.
              </p>
              <div className="mt-4">
                <button
                  onClick={() => setShowForm(false)}
                  className="w-full rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
