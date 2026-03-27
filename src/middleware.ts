import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow login page and static assets
  if (
    pathname === '/login' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // Check for Supabase auth token in cookies
  // Supabase stores auth in cookies with project-specific names
  const cookies = request.cookies.getAll()

  // Look for any Supabase auth cookie (handles various cookie naming patterns)
  const hasAuthCookie = cookies.some(cookie =>
    cookie.name.includes('sb-') &&
    (cookie.name.includes('-auth-token') ||
     cookie.name === 'sb-access-token' ||
     cookie.name === 'sb-refresh-token')
  )

  // If no auth cookies found, redirect to login
  if (!hasAuthCookie) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
