'use client'

import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, isSameDay } from 'date-fns'

interface CalendarItem {
  id: string
  title: string
  scheduled_date: string
  scheduled_time: string | null
  platforms: string[]
  status: string
  content_type: string
}

const mockItems: CalendarItem[] = [
  {
    id: '1',
    title: 'Hip Hop Class Spotlight',
    scheduled_date: format(new Date(), 'yyyy-MM-dd'),
    scheduled_time: '10:00',
    platforms: ['facebook', 'instagram'],
    status: 'scheduled',
    content_type: 'post'
  },
  {
    id: '2',
    title: 'Spring Recital Announcement',
    scheduled_date: format(addMonths(new Date(), 0), 'yyyy-MM-dd'),
    scheduled_time: '14:00',
    platforms: ['facebook'],
    status: 'draft',
    content_type: 'event'
  }
]

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  const getItemsForDate = (date: Date) => {
    return mockItems.filter(item =>
      isSameDay(new Date(item.scheduled_date), date)
    )
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Content Calendar</h1>
            <p className="mt-1 text-sm text-gray-600">
              Plan and schedule your social media content
            </p>
          </div>
          <a
            href="/ai-generator"
            className="inline-flex items-center rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Post
          </a>
        </div>

        <div className="mt-8 rounded-lg bg-white shadow">
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {format(currentMonth, 'MMMM yyyy')}
            </h2>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="rounded-md p-2 hover:bg-gray-100"
              >
                <ChevronLeft className="h-5 w-5 text-gray-600" />
              </button>
              <button
                onClick={() => setCurrentMonth(new Date())}
                className="rounded-md px-3 py-1 text-sm font-medium hover:bg-gray-100"
              >
                Today
              </button>
              <button
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="rounded-md p-2 hover:bg-gray-100"
              >
                <ChevronRight className="h-5 w-5 text-gray-600" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-gray-200">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div
                key={day}
                className="border-r border-gray-200 px-3 py-2 text-center text-sm font-medium text-gray-500 last:border-r-0"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {/* Empty cells for days before month starts */}
            {Array.from({ length: monthStart.getDay() }).map((_, index) => (
              <div
                key={`empty-start-${index}`}
                className="min-h-[100px] border-b border-r border-gray-200 bg-gray-50 last:border-r-0"
              />
            ))}

            {days.map((day) => {
              const dayItems = getItemsForDate(day)
              const isSelected = selectedDate && isSameDay(day, selectedDate)

              return (
                <div
                  key={day.toString()}
                  onClick={() => setSelectedDate(day)}
                  className={`min-h-[100px] cursor-pointer border-b border-r border-gray-200 p-2 last:border-r-0 hover:bg-gray-50 ${
                    !isSameMonth(day, currentMonth) ? 'bg-gray-50' : ''
                  } ${isSelected ? 'bg-purple-50' : ''}`}
                >
                  <div
                    className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                      isToday(day)
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-700'
                    }`}
                  >
                    {format(day, 'd')}
                  </div>
                  <div className="space-y-1">
                    {dayItems.slice(0, 2).map((item) => (
                      <div
                        key={item.id}
                        className={`truncate rounded px-1 py-0.5 text-xs ${
                          item.status === 'scheduled'
                            ? 'bg-green-100 text-green-800'
                            : item.status === 'draft'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {item.title}
                      </div>
                    ))}
                    {dayItems.length > 2 && (
                      <div className="text-xs text-gray-500">
                        +{dayItems.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Empty cells for days after month ends */}
            {Array.from({ length: 6 - monthEnd.getDay() }).map((_, index) => (
              <div
                key={`empty-end-${index}`}
                className="min-h-[100px] border-b border-r border-gray-200 bg-gray-50 last:border-r-0"
              />
            ))}
          </div>
        </div>

        {selectedDate && (
          <div className="mt-6 rounded-lg bg-white p-6 shadow">
            <h3 className="text-lg font-medium text-gray-900">
              {format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </h3>
            <div className="mt-4 space-y-3">
              {getItemsForDate(selectedDate).length > 0 ? (
                getItemsForDate(selectedDate).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 p-4"
                  >
                    <div>
                      <h4 className="font-medium text-gray-900">{item.title}</h4>
                      <p className="text-sm text-gray-500">
                        {item.scheduled_time} - {item.platforms.join(', ')}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        item.status === 'scheduled'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No posts scheduled for this day</p>
              )}
              <button className="mt-2 text-sm font-medium text-purple-600 hover:text-purple-700">
                + Add post for this day
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
