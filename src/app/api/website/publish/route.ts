import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { access } from 'fs/promises'

const execAsync = promisify(exec)

const NDCE_PLATFORM_ROOT = '/Users/drewjohnson/Downloads/ProBono Kids Activities Memory/clients/nicoles-dance-center-elite/ndce-platform'

interface PublishRequest {
  action: 'publish' | 'rollback' | 'status'
  commitMessage?: string
}

// Check if local filesystem is available
async function isLocalAvailable(): Promise<boolean> {
  try {
    await access(NDCE_PLATFORM_ROOT)
    return true
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: PublishRequest = await request.json()
    const { action, commitMessage } = body

    // Check if we're in local mode
    const localAvailable = await isLocalAvailable()

    if (!localAvailable) {
      // In GitHub mode, changes are committed directly - no staging
      if (action === 'publish') {
        return NextResponse.json({
          success: true,
          action: 'published',
          message: 'In GitHub mode, changes are committed directly when applied. No separate publish step needed.',
          mode: 'github',
        })
      } else if (action === 'rollback') {
        return NextResponse.json({
          success: false,
          action: 'rollback',
          message: 'Rollback not available in GitHub mode. Use git revert on the repository to undo changes.',
          mode: 'github',
        })
      }
    }

    // Local mode
    if (action === 'publish') {
      // Check if there are staged changes
      const { stdout: statusOutput } = await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git status --porcelain`)

      if (!statusOutput.trim()) {
        return NextResponse.json({
          success: false,
          message: 'No changes to publish',
          mode: 'local',
        })
      }

      // Stage all changes
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git add -A`)

      // Commit with message
      const message = commitMessage || `Website update via admin panel - ${new Date().toISOString()}`
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git commit -m "${message}"`)

      // Push to GitHub (triggers Vercel auto-deploy)
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git push origin main`)

      return NextResponse.json({
        success: true,
        action: 'published',
        message: 'Changes published successfully. Deployment will begin shortly.',
        deployUrl: 'https://ndce-platform.vercel.app',
        mode: 'local',
      })

    } else if (action === 'rollback') {
      // Discard all uncommitted changes
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git checkout -- .`)
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git clean -fd`)

      return NextResponse.json({
        success: true,
        action: 'rolled_back',
        message: 'Changes have been discarded.',
        mode: 'local',
      })
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "publish" or "rollback".' },
      { status: 400 }
    )

  } catch (error) {
    console.error('Publish error:', error)
    return NextResponse.json(
      { error: 'Failed to process request', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET endpoint to check staged changes status
export async function GET() {
  // Check if we're in local mode
  const localAvailable = await isLocalAvailable()

  if (!localAvailable) {
    // GitHub mode - no local staging
    return NextResponse.json({
      hasChanges: false,
      changedFiles: [],
      diffSummary: '',
      message: 'In GitHub mode, changes are committed directly. No local staging.',
      mode: 'github',
    })
  }

  try {
    const { stdout: statusOutput } = await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git status --porcelain`)
    const { stdout: diffOutput } = await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git diff --stat 2>/dev/null || echo ""`)

    const hasChanges = statusOutput.trim().length > 0
    const changedFiles = statusOutput.trim().split('\n').filter(Boolean).map(line => {
      const status = line.substring(0, 2).trim()
      const file = line.substring(3)
      return { status, file }
    })

    return NextResponse.json({
      hasChanges,
      changedFiles,
      diffSummary: diffOutput.trim(),
      mode: 'local',
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    )
  }
}
