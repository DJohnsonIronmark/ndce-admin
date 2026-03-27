// GitHub staging store for human-in-the-loop approval
// Stores pending changes until approved or rejected

export interface StagedFile {
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

export interface StagedChanges {
  id: string
  createdAt: string
  findText: string
  replaceText: string
  files: StagedFile[]
  matchCount: number
  status: 'pending' | 'approved' | 'rejected'
}

// Generic staged change for file operations
export interface GenericStagedChange {
  id: string
  type: 'find_replace' | 'file_write' | 'file_edit' | 'file_delete'
  createdAt: string
  status?: 'pending' | 'approved' | 'rejected'
  // For find_replace
  findText?: string
  replaceText?: string
  files?: StagedFile[]
  matchCount?: number
  // For file operations
  path?: string
  content?: string
  sha?: string
  description?: string
  oldContent?: string
  newContent?: string
}

// In-memory store for staged changes (persists across requests in same instance)
// For production, consider using Vercel KV or a database
const stagedChangesStore = new Map<string, StagedChanges>()
const genericStagedStore = new Map<string, GenericStagedChange>()

// Generate a unique ID for staged changes
export function generateStagingId(): string {
  return `staged_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

// Store staged changes
export function stageChanges(changes: Omit<StagedChanges, 'id' | 'createdAt' | 'status'>): StagedChanges {
  const id = generateStagingId()
  const staged: StagedChanges = {
    ...changes,
    id,
    createdAt: new Date().toISOString(),
    status: 'pending',
  }
  stagedChangesStore.set(id, staged)

  // Clean up old staged changes (older than 1 hour)
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  for (const [key, value] of stagedChangesStore.entries()) {
    if (new Date(value.createdAt).getTime() < oneHourAgo) {
      stagedChangesStore.delete(key)
    }
  }

  return staged
}

// Get staged changes by ID
export function getStagedChanges(id: string): StagedChanges | undefined {
  return stagedChangesStore.get(id)
}

// Get all pending staged changes
export function getAllPendingChanges(): StagedChanges[] {
  return Array.from(stagedChangesStore.values())
    .filter(c => c.status === 'pending')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// Update staged changes status
export function updateStagedStatus(id: string, status: 'approved' | 'rejected'): boolean {
  const staged = stagedChangesStore.get(id)
  if (!staged) return false
  staged.status = status
  return true
}

// Remove staged changes
export function removeStagedChanges(id: string): boolean {
  return stagedChangesStore.delete(id)
}

// Clear all staged changes
export function clearAllStaged(): void {
  stagedChangesStore.clear()
  genericStagedStore.clear()
}

// Add a generic staged change (for file operations)
export function addStagedChange(change: Omit<GenericStagedChange, 'status'>): GenericStagedChange {
  const staged: GenericStagedChange = {
    ...change,
    status: 'pending',
  }
  genericStagedStore.set(change.id, staged)

  // Clean up old staged changes (older than 1 hour)
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  for (const [key, value] of genericStagedStore.entries()) {
    if (new Date(value.createdAt).getTime() < oneHourAgo) {
      genericStagedStore.delete(key)
    }
  }

  return staged
}

// Get a generic staged change
export function getGenericStagedChange(id: string): GenericStagedChange | undefined {
  return genericStagedStore.get(id)
}

// Get all generic pending changes
export function getAllGenericPendingChanges(): GenericStagedChange[] {
  return Array.from(genericStagedStore.values())
    .filter(c => c.status === 'pending')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// Update generic staged change status
export function updateGenericStagedStatus(id: string, status: 'approved' | 'rejected'): boolean {
  const staged = genericStagedStore.get(id)
  if (!staged) return false
  staged.status = status
  return true
}

// Remove generic staged change
export function removeGenericStagedChange(id: string): boolean {
  return genericStagedStore.delete(id)
}
