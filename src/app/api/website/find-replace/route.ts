import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, copyFile, readdir, mkdir, access } from 'fs/promises'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { findAndReplace as githubFindAndReplace, isGitHubAvailable, searchInFiles, prepareChangesForStaging } from '@/lib/github'
import { stageChanges, type StagedFile } from '@/lib/github-staging'

const execAsync = promisify(exec)

interface FindReplaceRequest {
  find: string
  replace: string
  preview?: boolean
  caseSensitive?: boolean
  autoDeploy?: boolean
  staged?: boolean
}

interface FileMatch {
  file: string
  relativePath: string
  line: number
  before: string
  after: string
  context: string
}

// ndce-platform paths (for local development)
const NDCE_PLATFORM_ROOT = '/Users/drewjohnson/Downloads/ProBono Kids Activities Memory/clients/nicoles-dance-center-elite/ndce-platform'
const NDCE_PLATFORM_PATH = `${NDCE_PLATFORM_ROOT}/src`
const BACKUP_DIR = `${NDCE_PLATFORM_ROOT}/backups`

// Check if local filesystem is available
async function isLocalAvailable(): Promise<boolean> {
  try {
    await access(NDCE_PLATFORM_PATH)
    return true
  } catch {
    return false
  }
}

// File extensions to search
const SEARCH_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js']

// Case-preserving replace function
function preserveCaseReplace(original: string, find: string, replace: string): string {
  if (original === find.toUpperCase()) return replace.toUpperCase()
  if (original === find.toLowerCase()) return replace.toLowerCase()
  if (original[0] === find[0].toUpperCase() && original.slice(1) === find.slice(1).toLowerCase()) {
    return replace[0].toUpperCase() + replace.slice(1).toLowerCase()
  }
  return replace
}

// Recursively get all files in a directory (local mode)
async function getAllFiles(dir: string, files: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', '.git', 'backups'].includes(entry.name)) {
        await getAllFiles(fullPath, files)
      }
    } else if (SEARCH_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath)
    }
  }

  return files
}

// Escape special regex characters
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Get surrounding context for a match
function getContext(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - 1)
  const end = Math.min(lines.length - 1, lineIndex + 1)

  return lines
    .slice(start, end + 1)
    .map((l, i) => `${start + i + 1}: ${l.trim().substring(0, 100)}`)
    .join('\n')
}

// GitHub-based find and replace with human-in-the-loop approval
async function handleGitHubFindReplace(body: FindReplaceRequest) {
  const { find, replace = '', preview = false, caseSensitive = false } = body

  if (!isGitHubAvailable()) {
    return NextResponse.json(
      { error: 'GitHub token not configured. Set GITHUB_TOKEN environment variable.' },
      { status: 500 }
    )
  }

  try {
    // For preview mode, use the existing function
    if (preview) {
      const result = await githubFindAndReplace(find, replace, caseSensitive, true)

      if (result.matchCount === 0) {
        return NextResponse.json({
          success: false,
          message: `No matches found for "${find}" in the repository`,
          matchCount: 0,
          mode: 'github',
        })
      }

      return NextResponse.json({
        success: true,
        preview: true,
        matchCount: result.matchCount,
        filesAffected: result.filesAffected,
        matches: result.matches.map(m => ({
          file: m.path,
          relativePath: m.path,
          line: m.line,
          before: m.before,
          after: m.after,
          context: `Line ${m.line}: ${m.before}`,
        })),
        message: `Found ${result.matchCount} occurrence(s) in ${result.filesAffected} file(s) that would be replaced`,
        mode: 'github',
      })
    }

    // For apply mode, stage the changes for human approval instead of committing directly
    const preparedChanges = await prepareChangesForStaging(find, replace, caseSensitive)

    if (preparedChanges.matchCount === 0) {
      return NextResponse.json({
        success: false,
        message: `No matches found for "${find}" in the repository`,
        matchCount: 0,
        mode: 'github',
      })
    }

    // Convert to StagedFile format and stage the changes
    const stagedFiles: StagedFile[] = preparedChanges.files.map(f => ({
      path: f.path,
      originalContent: f.originalContent,
      newContent: f.newContent,
      sha: f.sha,
      changes: f.changes,
    }))

    const staged = stageChanges({
      findText: find,
      replaceText: replace,
      files: stagedFiles,
      matchCount: preparedChanges.matchCount,
    })

    // Build matches array for response
    const allMatches = preparedChanges.files.flatMap(f =>
      f.changes.map(c => ({
        file: f.path,
        relativePath: f.path,
        line: c.line,
        before: c.before,
        after: c.after,
        context: `Line ${c.line}: ${c.before}`,
      }))
    )

    return NextResponse.json({
      success: true,
      preview: false,
      staged: true,
      stagingId: staged.id,
      matchCount: preparedChanges.matchCount,
      filesAffected: preparedChanges.files.length,
      matches: allMatches,
      requiresApproval: true,
      message: `Found ${preparedChanges.matchCount} occurrence(s) in ${preparedChanges.files.length} file(s). Changes staged for approval. Use the Publish button to approve and commit to GitHub.`,
      mode: 'github',
    })
  } catch (error) {
    console.error('GitHub find-replace error:', error)
    return NextResponse.json(
      { error: 'Failed to process find-replace via GitHub', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Local filesystem find and replace
async function handleLocalFindReplace(body: FindReplaceRequest) {
  const { find, replace, preview = false, caseSensitive = false, autoDeploy = false, staged = true } = body

  // Get all source files
  let files: string[]
  try {
    files = await getAllFiles(NDCE_PLATFORM_PATH)
  } catch (err) {
    console.error('Error reading directory:', err)
    return NextResponse.json(
      { error: 'Could not read ndce-platform source directory' },
      { status: 500 }
    )
  }

  // Create regex for finding matches
  const flags = caseSensitive ? 'g' : 'gi'
  const regex = new RegExp(escapeRegex(find), flags)

  // Find all matches across all files
  const allMatches: FileMatch[] = []
  const filesWithChanges: Map<string, string> = new Map()

  // Create a replacer function that preserves case
  const replacer = caseSensitive
    ? () => replace
    : (match: string) => preserveCaseReplace(match, find, replace)

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf-8')
      const lines = content.split('\n')
      let hasMatches = false

      lines.forEach((line, index) => {
        if (regex.test(line)) {
          regex.lastIndex = 0
          hasMatches = true

          const newLine = line.replace(regex, replacer)
          const relativePath = filePath.replace(NDCE_PLATFORM_PATH + '/', '')

          allMatches.push({
            file: filePath,
            relativePath,
            line: index + 1,
            before: line.trim().substring(0, 200),
            after: newLine.trim().substring(0, 200),
            context: getContext(lines, index),
          })
        }
      })

      if (hasMatches) {
        const newContent = content.replace(new RegExp(escapeRegex(find), flags), replacer)
        filesWithChanges.set(filePath, newContent)
      }
    } catch (err) {
      console.warn(`Could not read file ${filePath}:`, err)
    }
  }

  if (allMatches.length === 0) {
    return NextResponse.json({
      success: false,
      message: `No matches found for "${find}" in ndce-platform source files`,
      matchCount: 0,
      mode: 'local',
    })
  }

  // If preview mode, just return what would change
  if (preview) {
    return NextResponse.json({
      success: true,
      preview: true,
      matchCount: allMatches.length,
      filesAffected: filesWithChanges.size,
      matches: allMatches,
      message: `Found ${allMatches.length} occurrence(s) in ${filesWithChanges.size} file(s) that would be replaced`,
      mode: 'local',
    })
  }

  // Apply the changes
  // First, create backups
  try {
    await mkdir(BACKUP_DIR, { recursive: true })
    const timestamp = Date.now()

    for (const [filePath] of filesWithChanges) {
      const relativePath = filePath.replace(NDCE_PLATFORM_PATH + '/', '')
      const backupPath = join(BACKUP_DIR, `${timestamp}-${relativePath.replace(/\//g, '_')}`)
      await copyFile(filePath, backupPath)
    }
  } catch (backupError) {
    console.warn('Could not create backups:', backupError)
  }

  // Apply the replacements
  for (const [filePath, newContent] of filesWithChanges) {
    await writeFile(filePath, newContent)
  }

  // Handle deployment based on mode
  let deployResult: { committed: boolean; deployed: boolean; deployUrl?: string; error?: string } = {
    committed: false,
    deployed: false,
    deployUrl: undefined
  }

  if (autoDeploy && !staged) {
    // Immediate deploy via git
    try {
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git add -A`)
      const commitMessage = `Update: Replace "${find}" with "${replace}" (${allMatches.length} occurrences)`
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git commit -m "${commitMessage}"`)
      await execAsync(`cd "${NDCE_PLATFORM_ROOT}" && git push origin main`)
      deployResult = { committed: true, deployed: true, deployUrl: 'https://ndce-platform.vercel.app' }
    } catch (error) {
      console.error('Commit/deploy error:', error)
      deployResult = { committed: false, deployed: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  const isStaged = staged && !autoDeploy
  const message = deployResult.deployed
    ? `Successfully replaced ${allMatches.length} occurrence(s) and deployed to ${deployResult.deployUrl}`
    : isStaged
      ? `Changes staged for review. ${allMatches.length} occurrence(s) in ${filesWithChanges.size} file(s) ready for approval.`
      : `Successfully replaced ${allMatches.length} occurrence(s) in ${filesWithChanges.size} file(s)`

  return NextResponse.json({
    success: true,
    preview: false,
    staged: isStaged,
    matchCount: allMatches.length,
    filesAffected: filesWithChanges.size,
    matches: allMatches,
    committed: deployResult.committed,
    deployed: deployResult.deployed,
    deployUrl: deployResult.deployUrl,
    requiresApproval: isStaged,
    message,
    mode: 'local',
  })
}

export async function POST(request: NextRequest) {
  try {
    const body: FindReplaceRequest = await request.json()
    const { find } = body

    if (!find || find.trim() === '') {
      return NextResponse.json(
        { error: 'Find text is required' },
        { status: 400 }
      )
    }

    // Check if local filesystem is available
    const localAvailable = await isLocalAvailable()

    if (localAvailable) {
      // Use local filesystem (development mode)
      return handleLocalFindReplace(body)
    } else {
      // Use GitHub API (production/deployed mode)
      return handleGitHubFindReplace(body)
    }
  } catch (error) {
    console.error('Find-replace error:', error)
    return NextResponse.json(
      { error: 'Failed to process find-replace request' },
      { status: 500 }
    )
  }
}

// GET endpoint to search for text
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q')

  if (!query) {
    return NextResponse.json(
      { error: 'Query parameter "q" is required' },
      { status: 400 }
    )
  }

  // Check if local filesystem is available
  const localAvailable = await isLocalAvailable()

  if (!localAvailable) {
    // Use GitHub search
    if (!isGitHubAvailable()) {
      return NextResponse.json(
        { error: 'Neither local files nor GitHub token available' },
        { status: 500 }
      )
    }

    try {
      const matches = await searchInFiles(query)
      return NextResponse.json({
        success: true,
        query,
        matchCount: matches.length,
        matches: matches.map(m => ({
          file: m.path,
          relativePath: m.path,
          line: m.line,
          content: m.content,
        })),
        mode: 'github',
      })
    } catch (error) {
      return NextResponse.json(
        { error: 'Could not search repository' },
        { status: 500 }
      )
    }
  }

  // Local search
  try {
    const files = await getAllFiles(NDCE_PLATFORM_PATH)
    const regex = new RegExp(escapeRegex(query), 'gi')
    const matches: Array<{ file: string; relativePath: string; line: number; content: string }> = []

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf-8')
        const lines = content.split('\n')
        const relativePath = filePath.replace(NDCE_PLATFORM_PATH + '/', '')

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            regex.lastIndex = 0
            matches.push({
              file: filePath,
              relativePath,
              line: index + 1,
              content: line.trim().substring(0, 200),
            })
          }
        })
      } catch {
        // Skip files that can't be read
      }
    }

    return NextResponse.json({
      success: true,
      query,
      matchCount: matches.length,
      matches,
      mode: 'local',
    })
  } catch {
    return NextResponse.json(
      { error: 'Could not search ndce-platform source files' },
      { status: 500 }
    )
  }
}
