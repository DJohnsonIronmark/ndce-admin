import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOrServiceToken } from '@/lib/session'
import { createBranchFromMain, updateFile, getFileShaOnBranch, isGitHubAvailable } from '@/lib/github'

// Up to ~10 files, each a separate GitHub PUT (~1s each), plus the
// initial branch-create call. Allow up to 5 minutes.
export const maxDuration = 300

const VERCEL_PROJECT = process.env.VERCEL_SITE_PROJECT || 'ndce-site-v2'
const VERCEL_TEAM_SLUG = process.env.VERCEL_TEAM_SLUG || 'tjc-dashboards'

interface PreviewRequest {
  files: Array<{ path: string; newContent: string; sha?: string }>
  commitMessage?: string
}

// Generate a short, URL-safe branch id. We need this short to keep the
// resulting Vercel preview hostname under DNS label limits.
function newBranchId(): string {
  const t = Date.now().toString(36).slice(-5)
  const r = Math.random().toString(36).slice(2, 6)
  return `${t}${r}`
}

export async function POST(request: NextRequest) {
  const auth = await requireSessionOrServiceToken(request)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  if (!isGitHubAvailable()) {
    return NextResponse.json({ error: 'Storage not configured' }, { status: 500 })
  }

  let body: PreviewRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { files, commitMessage } = body
  if (!files || !Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ error: 'No files to preview' }, { status: 400 })
  }

  const branch = `staging-${newBranchId()}`

  const branchResult = await createBranchFromMain(branch)
  if (!branchResult.success) {
    return NextResponse.json(
      { success: false, error: `Failed to create staging branch: ${branchResult.error}` },
      { status: 500 },
    )
  }

  // Track current sha per path so consecutive commits to the same path
  // use the latest tip. In normal flows each path appears once, but the
  // map keeps us safe against duplicates.
  const shaMap = new Map<string, string | undefined>()
  for (const f of files) shaMap.set(f.path, f.sha)

  const message = commitMessage || `Staging update (${files.length} file${files.length === 1 ? '' : 's'}) via assistant`
  const results: Array<{ path: string; success: boolean; error?: string }> = []

  for (const f of files) {
    let sha = shaMap.get(f.path)
    if (!sha) {
      // Branch was just forked from main, so the SHA on the branch is
      // identical to the SHA on main for any file we haven't touched yet.
      const fetched = await getFileShaOnBranch(f.path, branch)
      sha = fetched ?? ''
    }
    const r = await updateFile(f.path, f.newContent, sha, message, branch)
    results.push({ path: f.path, success: r.success, error: r.error })
    if (r.success && r.sha) shaMap.set(f.path, r.sha)
  }

  const successCount = results.filter(r => r.success).length
  const previewUrl = `https://${VERCEL_PROJECT}-git-${branch}-${VERCEL_TEAM_SLUG}.vercel.app`
  const inspectUrl = `https://vercel.com/${VERCEL_TEAM_SLUG}/${VERCEL_PROJECT}/deployments?branch=${encodeURIComponent(branch)}`

  return NextResponse.json({
    success: successCount > 0,
    branch,
    previewUrl,
    inspectUrl,
    filesCommitted: successCount,
    totalFiles: files.length,
    errors: results.filter(r => !r.success),
    message: successCount === files.length
      ? `Committed ${successCount} file(s) to staging branch ${branch}. Vercel is building the preview.`
      : `Committed ${successCount} of ${files.length} files. Some failed.`,
  })
}
