// GitHub API utilities for file operations

const GITHUB_API = 'https://api.github.com'
const REPO_OWNER = 'DJohnsonIronmark'
const REPO_NAME = 'ndce-platform'
const DEFAULT_BRANCH = 'main'

interface GitHubFile {
  name: string
  path: string
  sha: string
  type: 'file' | 'dir'
  content?: string
  download_url?: string
}

interface FileMatch {
  path: string
  line: number
  content: string
  sha: string
}

interface UpdateResult {
  success: boolean
  path: string
  sha?: string
  error?: string
}

// Get GitHub token from environment
function getToken(): string {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable not set')
  }
  return token
}

// Make authenticated GitHub API request
async function githubFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API}${endpoint}`

  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  })
}

// Get all files in a directory recursively
export async function listFiles(path: string = 'src'): Promise<GitHubFile[]> {
  const response = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`)

  if (!response.ok) {
    throw new Error(`Failed to list files: ${response.status}`)
  }

  const items: GitHubFile[] = await response.json()
  const files: GitHubFile[] = []

  for (const item of items) {
    // Include source code, styles, and markdown so the assistant can find
    // CSS classes (e.g. .btn-primary in globals.css) and content files.
    if (item.type === 'file' && /\.(tsx?|jsx?|json|css|scss|md|mdx)$/.test(item.name)) {
      files.push(item)
    } else if (item.type === 'dir' && !['node_modules', '.next', '.git'].includes(item.name)) {
      const subFiles = await listFiles(item.path)
      files.push(...subFiles)
    }
  }

  return files
}

// Get file content
export async function getFileContent(path: string): Promise<{ content: string; sha: string }> {
  const response = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`)

  if (!response.ok) {
    throw new Error(`Failed to get file: ${response.status}`)
  }

  const data = await response.json()
  const content = Buffer.from(data.content, 'base64').toString('utf-8')

  return { content, sha: data.sha }
}

// Search for text in all source files
export async function searchInFiles(searchText: string, caseSensitive: boolean = false): Promise<FileMatch[]> {
  const files = await listFiles('src')
  const matches: FileMatch[] = []
  const searchLower = caseSensitive ? searchText : searchText.toLowerCase()

  for (const file of files) {
    try {
      const { content, sha } = await getFileContent(file.path)
      const lines = content.split('\n')

      lines.forEach((line, index) => {
        const compareLine = caseSensitive ? line : line.toLowerCase()
        if (compareLine.includes(searchLower)) {
          matches.push({
            path: file.path,
            line: index + 1,
            content: line.trim().substring(0, 200),
            sha,
          })
        }
      })
    } catch (error) {
      console.warn(`Could not read ${file.path}:`, error)
    }
  }

  return matches
}

// Update a single file
export async function updateFile(
  path: string,
  newContent: string,
  sha: string,
  message: string
): Promise<UpdateResult> {
  try {
    const response = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(newContent).toString('base64'),
        sha,
        branch: DEFAULT_BRANCH,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      return { success: false, path, error: error.message || `HTTP ${response.status}` }
    }

    const data = await response.json()
    return { success: true, path, sha: data.content.sha }
  } catch (error) {
    return { success: false, path, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Find and replace text across multiple files
export async function findAndReplace(
  findText: string,
  replaceText: string,
  caseSensitive: boolean = false,
  preview: boolean = false
): Promise<{
  matches: Array<{
    path: string
    line: number
    before: string
    after: string
  }>
  filesAffected: number
  matchCount: number
  updates?: UpdateResult[]
}> {
  const files = await listFiles('src')
  const matches: Array<{
    path: string
    line: number
    before: string
    after: string
    sha: string
    fullContent: string
    newContent: string
  }> = []

  const flags = caseSensitive ? 'g' : 'gi'
  const regex = new RegExp(escapeRegex(findText), flags)

  // Case-preserving replace function
  const preserveCaseReplace = (original: string, find: string, replace: string): string => {
    if (original === find.toUpperCase()) return replace.toUpperCase()
    if (original === find.toLowerCase()) return replace.toLowerCase()
    if (original[0] === find[0].toUpperCase() && original.slice(1) === find.slice(1).toLowerCase()) {
      return replace[0].toUpperCase() + replace.slice(1).toLowerCase()
    }
    return replace
  }

  const replacer = caseSensitive
    ? () => replaceText
    : (match: string) => preserveCaseReplace(match, findText, replaceText)

  const filesToUpdate = new Map<string, { sha: string; content: string; newContent: string }>()

  for (const file of files) {
    try {
      const { content, sha } = await getFileContent(file.path)
      const lines = content.split('\n')
      let hasMatches = false

      lines.forEach((line, index) => {
        if (regex.test(line)) {
          regex.lastIndex = 0
          hasMatches = true
          const newLine = line.replace(regex, replacer)

          matches.push({
            path: file.path,
            line: index + 1,
            before: line.trim().substring(0, 200),
            after: newLine.trim().substring(0, 200),
            sha,
            fullContent: content,
            newContent: content.replace(new RegExp(escapeRegex(findText), flags), replacer),
          })
        }
      })

      if (hasMatches) {
        const newContent = content.replace(new RegExp(escapeRegex(findText), flags), replacer)
        filesToUpdate.set(file.path, { sha, content, newContent })
      }
    } catch (error) {
      console.warn(`Could not process ${file.path}:`, error)
    }
  }

  const result = {
    matches: matches.map(m => ({
      path: m.path,
      line: m.line,
      before: m.before,
      after: m.after,
    })),
    filesAffected: filesToUpdate.size,
    matchCount: matches.length,
    updates: undefined as UpdateResult[] | undefined,
  }

  // If not preview, apply the changes
  if (!preview && filesToUpdate.size > 0) {
    const updates: UpdateResult[] = []

    for (const [path, { sha, newContent }] of filesToUpdate) {
      const commitMessage = `Update: Replace "${findText}" with "${replaceText}" in ${path.split('/').pop()}`
      const updateResult = await updateFile(path, newContent, sha, commitMessage)
      updates.push(updateResult)
    }

    result.updates = updates
  }

  return result
}

// Escape special regex characters
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Check if GitHub token is available
export function isGitHubAvailable(): boolean {
  return !!process.env.GITHUB_TOKEN
}

// Upload a binary file (image, video, etc.) directly to the site repo.
// Skips the read-decode-as-utf8 path used by updateFile, which would
// corrupt non-text content.
export async function uploadBinaryFile(
  path: string,
  base64Content: string,
  message: string,
): Promise<UpdateResult> {
  try {
    const response = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: base64Content,
        branch: DEFAULT_BRANCH,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return { success: false, path, error: error.message || `HTTP ${response.status}` }
    }

    const data = await response.json()
    return { success: true, path, sha: data.content.sha }
  } catch (error) {
    return { success: false, path, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Get repository info
export async function getRepoInfo(): Promise<{ name: string; default_branch: string; html_url: string }> {
  const response = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}`)

  if (!response.ok) {
    throw new Error(`Failed to get repo info: ${response.status}`)
  }

  return response.json()
}

// Prepare changes for staging (returns file data without committing)
export interface StagedFileData {
  path: string
  originalContent: string
  newContent: string
  sha: string
  changes: Array<{
    line: number
    before: string
    after: string
  }>
}

export async function prepareChangesForStaging(
  findText: string,
  replaceText: string,
  caseSensitive: boolean = false
): Promise<{
  files: StagedFileData[]
  matchCount: number
}> {
  const files = await listFiles('src')
  const stagedFiles: StagedFileData[] = []
  let totalMatchCount = 0

  const flags = caseSensitive ? 'g' : 'gi'
  const regex = new RegExp(escapeRegex(findText), flags)

  const preserveCaseReplace = (original: string, find: string, replace: string): string => {
    if (original === find.toUpperCase()) return replace.toUpperCase()
    if (original === find.toLowerCase()) return replace.toLowerCase()
    if (original[0] === find[0].toUpperCase() && original.slice(1) === find.slice(1).toLowerCase()) {
      return replace[0].toUpperCase() + replace.slice(1).toLowerCase()
    }
    return replace
  }

  const replacer = caseSensitive
    ? () => replaceText
    : (match: string) => preserveCaseReplace(match, findText, replaceText)

  for (const file of files) {
    try {
      const { content, sha } = await getFileContent(file.path)
      const lines = content.split('\n')
      const changes: Array<{ line: number; before: string; after: string }> = []

      lines.forEach((line, index) => {
        if (regex.test(line)) {
          regex.lastIndex = 0
          const newLine = line.replace(regex, replacer)
          changes.push({
            line: index + 1,
            before: line.trim().substring(0, 200),
            after: newLine.trim().substring(0, 200),
          })
        }
      })

      if (changes.length > 0) {
        const newContent = content.replace(new RegExp(escapeRegex(findText), flags), replacer)
        stagedFiles.push({
          path: file.path,
          originalContent: content,
          newContent,
          sha,
          changes,
        })
        totalMatchCount += changes.length
      }
    } catch (error) {
      console.warn(`Could not process ${file.path}:`, error)
    }
  }

  return { files: stagedFiles, matchCount: totalMatchCount }
}

// Commit staged changes to GitHub
export async function commitStagedChanges(
  files: Array<{ path: string; newContent: string; sha: string }>,
  commitMessage: string
): Promise<UpdateResult[]> {
  const results: UpdateResult[] = []

  for (const file of files) {
    const result = await updateFile(file.path, file.newContent, file.sha, commitMessage)
    results.push(result)
  }

  return results
}
