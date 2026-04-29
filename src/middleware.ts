import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/session'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow login page, auth API, static assets, all other API routes, and files with extensions.
  if (
    pathname === '/login' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  const secret = process.env.SESSION_SECRET
  if (!secret) {
    // Fail closed when not configured.
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('error', 'config')
    return NextResponse.redirect(loginUrl)
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const payload = await verifySession(token, secret)
  if (!payload) {
    const res = NextResponse.redirect(new URL('/login', request.url))
    res.cookies.delete(SESSION_COOKIE_NAME)
    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Match everything except static asset extensions and Next internals.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
