'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarDays,
  MessageSquare,
  Sparkles,
  Settings,
  LayoutDashboard,
  Calendar,
  Users,
  Bot,
  FileEdit,
} from 'lucide-react'

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'AI Assistant', href: '/assistant', icon: Bot, highlight: true },
  { name: 'Content Calendar', href: '/calendar', icon: CalendarDays },
  { name: 'AI Generator', href: '/ai-generator', icon: Sparkles },
  { name: 'Posts', href: '/posts', icon: MessageSquare },
  { name: 'Events', href: '/events', icon: Calendar },
  { name: 'Templates', href: '/templates', icon: FileEdit },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-64 flex-col bg-gray-900">
      <div className="flex h-16 items-center justify-center border-b border-gray-800">
        <h1 className="text-xl font-bold text-white">NDCE Admin</h1>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`group flex items-center rounded-md px-3 py-2 text-sm font-medium ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : (item as { highlight?: boolean }).highlight
                  ? 'bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 hover:text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <item.icon
                className={`mr-3 h-5 w-5 flex-shrink-0 ${
                  isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-300'
                }`}
              />
              {item.name}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-gray-800 p-4">
        <p className="text-xs text-gray-500">Nicole&apos;s Dance Center Elite</p>
      </div>
    </div>
  )
}
