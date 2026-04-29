import { NextRequest, NextResponse } from 'next/server'
import { uploadBinaryFile, isGitHubAvailable } from '@/lib/github'
import { requireSession } from '@/lib/session'

// Direct commit to the site repo's public/uploads folder.
// Pre-uploaded so the assistant can reference the path in JSX edits.
export const maxDuration = 60

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])
const MAX_BYTES = 10 * 1024 * 1024 // 10MB

function slugify(name: string): string {
  // Strip path components, lowercase, collapse non-safe chars to single dash.
  const base = name.split(/[\\/]/).pop() || name
  return base
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80)
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  if (!isGitHubAvailable()) {
    return NextResponse.json({ error: 'Storage not configured' }, { status: 500 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported type: ${file.type}. Allowed: ${[...ALLOWED_MIME].join(', ')}` },
      { status: 415 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes; max ${MAX_BYTES} bytes)` },
      { status: 413 },
    )
  }

  const ts = Date.now()
  const safeName = slugify(file.name) || `upload-${ts}.bin`
  const repoPath = `public/uploads/${ts}-${safeName}`

  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')

  const result = await uploadBinaryFile(
    repoPath,
    base64,
    `Upload image via assistant: ${file.name}`,
  )

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || 'Upload failed' },
      { status: 500 },
    )
  }

  // Public-facing URL path the assistant can drop into JSX as src=...
  const publicPath = repoPath.replace(/^public/, '')

  return NextResponse.json({
    success: true,
    path: publicPath,
    originalName: file.name,
    bytes: file.size,
    contentType: file.type,
  })
}
