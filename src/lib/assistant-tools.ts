// Tool definitions for the NDCE AI Assistant
// These tools give the assistant Claude Code-like capabilities

import Anthropic from '@anthropic-ai/sdk'
import { listFiles as ghListFiles, getFileContent, updateFile, searchInFiles, isGitHubAvailable } from './github'

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'review_website',
    description: 'Crawl and review the entire NDCE website to understand current content across all pages (Home, About, Classes, Schedule, Contact). Returns full text content, key information like ages mentioned, phone numbers, and emails.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_website',
    description: 'Search for specific text on the NDCE website. Returns whether the text was found, how many times, and context around the matches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        searchText: {
          type: 'string',
          description: 'The text to search for on the website',
        },
      },
      required: ['searchText'],
    },
  },
  {
    name: 'preview_find_replace',
    description: 'Preview what would change if we replaced text on the website. Shows all matches and the before/after for each. Does NOT make any changes - just shows what would happen.',
    input_schema: {
      type: 'object' as const,
      properties: {
        findText: {
          type: 'string',
          description: 'The text to find',
        },
        replaceText: {
          type: 'string',
          description: 'The text to replace it with (use empty string to remove)',
        },
      },
      required: ['findText', 'replaceText'],
    },
  },
  {
    name: 'apply_find_replace',
    description: 'Apply a find-and-replace operation to the website. This stages the changes for human approval - they will NOT go live until the user clicks Approve. Always preview first before applying.',
    input_schema: {
      type: 'object' as const,
      properties: {
        findText: {
          type: 'string',
          description: 'The text to find',
        },
        replaceText: {
          type: 'string',
          description: 'The text to replace it with (use empty string to remove)',
        },
      },
      required: ['findText', 'replaceText'],
    },
  },
  {
    name: 'search_source_code',
    description: 'Search the website source code (GitHub repository) for specific text. Useful for finding exact variable names, component text, or understanding code structure.',
    input_schema: {
      type: 'object' as const,
      properties: {
        searchText: {
          type: 'string',
          description: 'The text to search for in the source code',
        },
      },
      required: ['searchText'],
    },
  },
  {
    name: 'get_staged_changes',
    description: 'Check what changes are currently staged and awaiting approval.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_task_list',
    description: 'Create a list of tasks to be executed. Use this when the user has multiple requests that need to be tracked and executed separately.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['find_replace', 'verify', 'website_update', 'question'],
                description: 'The type of task',
              },
              description: {
                type: 'string',
                description: 'Human-readable description of the task',
              },
              findText: {
                type: 'string',
                description: 'For find_replace tasks: text to find',
              },
              replaceText: {
                type: 'string',
                description: 'For find_replace tasks: text to replace with',
              },
              verifyText: {
                type: 'string',
                description: 'For verify tasks: text to verify exists',
              },
              status: {
                type: 'string',
                enum: ['ready', 'pending'],
                description: 'ready if all info is available, pending if more info needed',
              },
            },
            required: ['type', 'description', 'status'],
          },
          description: 'Array of tasks to create',
        },
      },
      required: ['tasks'],
    },
  },
  // ========== ADVANCED FILE TOOLS ==========
  {
    name: 'list_files',
    description: 'List all source files in the website codebase. Returns file paths organized by directory. Use this to understand the project structure before making changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'The directory to list files from (default: "src"). Examples: "src", "src/components", "src/app"',
        },
      },
      required: [],
    },
  },
  {
    name: 'read_file',
    description: 'Read the full content of a source file. Use this to understand existing code before making changes. Always read a file before trying to edit it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The file path relative to the repository root. Example: "src/components/Header.tsx"',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a new file or completely replace an existing file. This stages the changes for human approval - they will NOT go live until approved. Use edit_file for targeted changes to existing files.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The file path relative to the repository root. Example: "src/components/NewComponent.tsx"',
        },
        content: {
          type: 'string',
          description: 'The complete file content to write',
        },
        description: {
          type: 'string',
          description: 'Brief description of what this file does or why it was created',
        },
      },
      required: ['path', 'content', 'description'],
    },
  },
  {
    name: 'edit_file',
    description: 'Make a targeted edit to a specific part of a file by replacing old content with new content. This stages the changes for human approval. Always read the file first to get the exact text to replace.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The file path relative to the repository root',
        },
        oldContent: {
          type: 'string',
          description: 'The exact text to find and replace (must match exactly, including whitespace)',
        },
        newContent: {
          type: 'string',
          description: 'The new text to replace it with',
        },
        description: {
          type: 'string',
          description: 'Brief description of what this edit does',
        },
      },
      required: ['path', 'oldContent', 'newContent', 'description'],
    },
  },
  {
    name: 'get_component_info',
    description: 'Get information about a React component including its props, structure, and where it is used. Useful for understanding how to modify or extend components.',
    input_schema: {
      type: 'object' as const,
      properties: {
        componentName: {
          type: 'string',
          description: 'The name of the component to analyze. Example: "Header", "ContactSection"',
        },
      },
      required: ['componentName'],
    },
  },
]

// Execute a tool and return the result
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  baseUrl: string
): Promise<string> {
  try {
    switch (toolName) {
      case 'review_website': {
        const response = await fetch(`${baseUrl}/api/website/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'review' }),
        })
        const data = await response.json()
        if (!data.success) {
          return `Error reviewing website: ${data.error || 'Unknown error'}`
        }
        // Format the review nicely
        const review = data.review
        let result = `## Website Review Complete\n\n`
        result += `**Title:** ${review.title}\n`
        result += `**Total Words:** ${review.wordCount}\n`
        result += `**Pages Crawled:** ${data.pagesCrawled?.join(', ') || 'Unknown'}\n\n`

        if (review.keyInfo) {
          result += `### Key Information Found\n`
          if (review.keyInfo.ages?.length) {
            result += `- **Ages Mentioned:** ${review.keyInfo.ages.join(', ')}\n`
          }
          if (review.keyInfo.phoneNumbers?.length) {
            result += `- **Phone Numbers:** ${review.keyInfo.phoneNumbers.join(', ')}\n`
          }
          if (review.keyInfo.emails?.length) {
            result += `- **Emails:** ${review.keyInfo.emails.join(', ')}\n`
          }
        }

        result += `\n### Content by Page\n`
        for (const section of review.sections || []) {
          result += `\n**${section.name}:**\n${section.content.substring(0, 1500)}${section.content.length > 1500 ? '...' : ''}\n`
        }

        return result
      }

      case 'search_website': {
        const { searchText } = toolInput as { searchText: string }
        const response = await fetch(`${baseUrl}/api/website/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ searchText, mode: 'search' }),
        })
        const data = await response.json()
        if (data.found) {
          return `Found "${searchText}" ${data.match.count} time(s) on the website.\n\nContext: "${data.match.context}"`
        } else {
          return `"${searchText}" was NOT found on the website.`
        }
      }

      case 'preview_find_replace': {
        const { findText, replaceText } = toolInput as { findText: string; replaceText: string }
        const response = await fetch(`${baseUrl}/api/website/find-replace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ find: findText, replace: replaceText, preview: true }),
        })
        const data = await response.json()
        if (!data.success || data.matchCount === 0) {
          return `No matches found for "${findText}" in the website source code.`
        }
        let result = `## Preview: Replace "${findText}" with "${replaceText}"\n\n`
        result += `**Found ${data.matchCount} occurrence(s) in ${data.filesAffected} file(s)**\n\n`
        for (const match of data.matches?.slice(0, 10) || []) {
          result += `### ${match.file}:${match.line}\n`
          result += `- Before: \`${match.before}\`\n`
          result += `- After: \`${match.after}\`\n\n`
        }
        if (data.matchCount > 10) {
          result += `... and ${data.matchCount - 10} more matches\n`
        }
        return result
      }

      case 'apply_find_replace': {
        const { findText, replaceText } = toolInput as { findText: string; replaceText: string }
        const response = await fetch(`${baseUrl}/api/website/find-replace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ find: findText, replace: replaceText, preview: false }),
        })
        const data = await response.json()
        if (!data.success) {
          return `Failed to apply changes: ${data.message || 'Unknown error'}`
        }
        if (data.matchCount === 0) {
          return `No matches found for "${findText}". No changes were made.`
        }
        return `✅ **Find & Replace - STAGED (NOT LIVE)**\n\nReplaced ${data.matchCount} occurrence(s) in ${data.filesAffected} file(s).\n\n**Staging ID:** ${data.stagingId || 'N/A'}\n\n⚠️ **IMPORTANT:** These changes are in the staging area only. They will NOT appear on the website until the user clicks "Approve & Publish" in the right panel.\n\n📋 Tell the user: "I've staged these changes. Please click 'Approve & Publish' to make them live."`
      }

      case 'search_source_code': {
        const { searchText } = toolInput as { searchText: string }
        const response = await fetch(`${baseUrl}/api/website/find-replace?q=${encodeURIComponent(searchText)}`)
        const data = await response.json()
        if (!data.success || data.matchCount === 0) {
          return `No matches found for "${searchText}" in the source code.`
        }
        let result = `## Source Code Search: "${searchText}"\n\n`
        result += `**Found ${data.matchCount} occurrence(s)**\n\n`
        for (const match of data.matches?.slice(0, 15) || []) {
          result += `- **${match.relativePath}:${match.line}** - ${match.content?.substring(0, 100) || match.before?.substring(0, 100)}...\n`
        }
        return result
      }

      case 'get_staged_changes': {
        const response = await fetch(`${baseUrl}/api/website/publish`)
        const data = await response.json()
        if (!data.hasChanges) {
          return 'No changes are currently staged for approval.'
        }
        let result = `## Staged Changes Awaiting Approval\n\n`
        for (const change of data.pendingChanges || []) {
          result += `### Change Set: ${change.id}\n`
          result += `- **Find:** "${change.findText}"\n`
          result += `- **Replace:** "${change.replaceText}"\n`
          result += `- **Matches:** ${change.matchCount} in ${change.filesCount} file(s)\n`
          result += `- **Created:** ${change.createdAt}\n\n`
        }
        return result
      }

      case 'create_task_list': {
        const { tasks } = toolInput as { tasks: Array<{
          type: string
          description: string
          findText?: string
          replaceText?: string
          verifyText?: string
          status: string
        }> }
        // This tool doesn't make an API call - it returns the task list for the UI to handle
        return JSON.stringify({
          type: 'task_list',
          tasks: tasks.map((t, i) => ({
            id: `task-${Date.now()}-${i}`,
            ...t,
          })),
        })
      }

      // ========== ADVANCED FILE TOOLS ==========

      case 'list_files': {
        if (!isGitHubAvailable()) {
          return 'Error: GitHub integration is not configured. Cannot access source files.'
        }
        const { directory = 'src' } = toolInput as { directory?: string }
        try {
          const files = await ghListFiles(directory)

          // Group files by directory
          const grouped: Record<string, string[]> = {}
          for (const file of files) {
            const dir = file.path.split('/').slice(0, -1).join('/')
            if (!grouped[dir]) grouped[dir] = []
            grouped[dir].push(file.name)
          }

          let result = `## Files in ${directory}\n\n`
          result += `**Total files:** ${files.length}\n\n`

          for (const [dir, fileNames] of Object.entries(grouped).sort()) {
            result += `### ${dir}/\n`
            for (const name of fileNames.sort()) {
              result += `- ${name}\n`
            }
            result += '\n'
          }

          return result
        } catch (error) {
          return `Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }

      case 'read_file': {
        if (!isGitHubAvailable()) {
          return 'Error: GitHub integration is not configured. Cannot read source files.'
        }
        const { path } = toolInput as { path: string }
        try {
          const { content, sha } = await getFileContent(path)

          // Add line numbers for easier reference
          const lines = content.split('\n')
          const numberedContent = lines.map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`).join('\n')

          return `## File: ${path}\n\n**SHA:** ${sha}\n**Lines:** ${lines.length}\n\n\`\`\`\n${numberedContent}\n\`\`\``
        } catch (error) {
          return `Error reading file "${path}": ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }

      case 'write_file': {
        if (!isGitHubAvailable()) {
          return 'Error: GitHub integration is not configured. Cannot write files.'
        }
        const { path, content, description } = toolInput as { path: string; content: string; description: string }
        try {
          // Check if file exists to get its SHA
          let sha: string | undefined
          try {
            const existing = await getFileContent(path)
            sha = existing.sha
          } catch {
            // File doesn't exist, that's fine for creating new files
          }

          // Stage the write operation
          const response = await fetch(`${baseUrl}/api/website/file-operation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operation: 'write',
              path,
              content,
              sha,
              description,
            }),
          })

          const data = await response.json()

          if (data.success) {
            const action = sha ? 'updated' : 'created'
            return `✅ **File ${action} - STAGED (NOT LIVE)**\n\n**Path:** ${path}\n**Description:** ${description}\n**Lines:** ${content.split('\n').length}\n**Staging ID:** ${data.stagingId || 'N/A'}\n\n⚠️ **IMPORTANT:** This change is in the staging area only. It will NOT appear on the website until the user clicks "Approve & Publish" in the right panel.\n\n📋 Tell the user: "I've staged these changes. Please click 'Approve & Publish' to make them live."`
          } else {
            return `Failed to stage file write: ${data.message || 'Unknown error'}`
          }
        } catch (error) {
          return `Error writing file "${path}": ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }

      case 'edit_file': {
        if (!isGitHubAvailable()) {
          return 'Error: GitHub integration is not configured. Cannot edit files.'
        }
        const { path, oldContent, newContent, description } = toolInput as {
          path: string
          oldContent: string
          newContent: string
          description: string
        }
        try {
          // Read the current file
          const { content: currentContent, sha } = await getFileContent(path)

          // Check if old content exists
          if (!currentContent.includes(oldContent)) {
            return `Error: Could not find the specified text in "${path}".\n\nThe text you're looking for:\n\`\`\`\n${oldContent}\n\`\`\`\n\nMake sure to use the exact text including whitespace. Use read_file first to see the current content.`
          }

          // Create the new content
          const updatedContent = currentContent.replace(oldContent, newContent)

          // Stage the edit operation
          const response = await fetch(`${baseUrl}/api/website/file-operation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operation: 'edit',
              path,
              content: updatedContent,
              sha,
              description,
              oldContent,
              newContent,
            }),
          })

          const data = await response.json()

          if (data.success) {
            return `✅ **File Edit - STAGED (NOT LIVE)**\n\n**Path:** ${path}\n**Description:** ${description}\n**Staging ID:** ${data.stagingId || 'N/A'}\n\n**Change Preview:**\n- Removed: \`${oldContent.substring(0, 100)}${oldContent.length > 100 ? '...' : ''}\`\n- Added: \`${newContent.substring(0, 100)}${newContent.length > 100 ? '...' : ''}\`\n\n⚠️ **IMPORTANT:** This change is in the staging area only. It will NOT appear on the website until the user clicks "Approve & Publish" in the right panel.\n\n📋 Tell the user: "I've staged these changes. Please click 'Approve & Publish' to make them live."`
          } else {
            return `Failed to stage file edit: ${data.message || 'Unknown error'}`
          }
        } catch (error) {
          return `Error editing file "${path}": ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }

      case 'get_component_info': {
        if (!isGitHubAvailable()) {
          return 'Error: GitHub integration is not configured. Cannot analyze components.'
        }
        const { componentName } = toolInput as { componentName: string }
        try {
          // Search for the component definition
          const matches = await searchInFiles(`function ${componentName}`)
          const classMatches = await searchInFiles(`class ${componentName}`)
          const exportMatches = await searchInFiles(`export default ${componentName}`)
          const usageMatches = await searchInFiles(`<${componentName}`)

          const allDefinitions = [...matches, ...classMatches]

          let result = `## Component: ${componentName}\n\n`

          if (allDefinitions.length === 0) {
            result += `Component "${componentName}" not found in the codebase.\n\n`
            result += `**Tip:** Try searching for variations like:\n`
            result += `- "${componentName}Section"\n`
            result += `- "${componentName}Component"\n`
          } else {
            result += `### Definition\n`
            for (const def of allDefinitions.slice(0, 3)) {
              result += `- **${def.path}:${def.line}** - \`${def.content}\`\n`
            }
            result += '\n'

            if (usageMatches.length > 0) {
              result += `### Usage (${usageMatches.length} locations)\n`
              for (const usage of usageMatches.slice(0, 10)) {
                result += `- **${usage.path}:${usage.line}** - \`${usage.content}\`\n`
              }
              if (usageMatches.length > 10) {
                result += `- ... and ${usageMatches.length - 10} more\n`
              }
            }

            // Read the component file to get props
            if (allDefinitions[0]) {
              try {
                const { content } = await getFileContent(allDefinitions[0].path)

                // Look for interface/type definitions
                const propsMatch = content.match(/interface\s+\w*Props\s*\{([^}]+)\}/)
                if (propsMatch) {
                  result += `\n### Props\n\`\`\`typescript\ninterface Props {${propsMatch[1]}}\n\`\`\`\n`
                }
              } catch {
                // Could not read file, skip props
              }
            }
          }

          return result
        } catch (error) {
          return `Error analyzing component: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }

      default:
        return `Unknown tool: ${toolName}`
    }
  } catch (error) {
    return `Error executing ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}

// System prompt for the agentic assistant
export const AGENTIC_SYSTEM_PROMPT = `You are an AI assistant for Nicole's Dance Center Elite (NDCE), a dance studio in Lutz, FL.

You have full access to the website codebase and can make any changes the user requests. Your tools include:

## Content Tools (for text changes)
- **review_website** - Crawl and analyze all website pages
- **search_website** - Find specific text on the live site
- **search_source_code** - Search the codebase for text
- **preview_find_replace** - Preview what a text replacement would change
- **apply_find_replace** - Stage a text replacement for approval

## Advanced File Tools (for code changes)
- **list_files** - Browse the project structure
- **read_file** - Read any source file (ALWAYS read before editing)
- **write_file** - Create a new file or replace an existing file
- **edit_file** - Make targeted edits to specific parts of a file
- **get_component_info** - Analyze a React component's structure and usage

## ⛔ CRITICAL RULE - READ THIS CAREFULLY ⛔

**CHANGES ARE NEVER AUTOMATICALLY LIVE.**

When you use write_file, edit_file, or apply_find_replace:
1. Changes go to a STAGING area only
2. They do NOT appear on the live website
3. The user MUST manually approve and publish

**YOU MUST NEVER SAY:**
- ❌ "Changes are now live"
- ❌ "Published successfully"
- ❌ "The changes are deployed"
- ❌ "Your website has been updated"
- ❌ Any variation suggesting changes are visible on the site

**YOU MUST ALWAYS SAY:**
- ✅ "I've STAGED these changes for your review"
- ✅ "Click 'Approve & Publish' in the panel on the right to make these live"
- ✅ "The changes are ready for your approval but NOT yet on the website"

This is extremely important - users get confused when told something is live but they can't see it.

## How to Make Code Changes

1. **Simple text updates** (phone numbers, ages, typos):
   - Use search_website or search_source_code to find the text
   - Use preview_find_replace to see all occurrences
   - Use apply_find_replace to stage the change

2. **Add new content to existing pages**:
   - Use list_files to find relevant files
   - Use read_file to see the current code
   - Use edit_file to add the new content at the right location

3. **Create new components or pages**:
   - Use get_component_info to understand similar components
   - Use write_file to create the new file
   - Use edit_file to import/use it where needed

4. **Modify component behavior**:
   - Use read_file to understand the current implementation
   - Use edit_file to make targeted changes
   - Preserve the existing code style and patterns

## Best Practices

- **Always read before editing**: Use read_file before edit_file to get exact text
- **Make targeted edits**: Use edit_file for small changes, not write_file
- **Preserve code style**: Match the existing indentation and formatting
- **One change at a time**: Make small, focused changes that are easy to review
- **Explain your changes**: Tell the user what you changed and why

## Project Structure (NDCE Website)

\`\`\`
src/
  app/           # Next.js pages and layouts
  components/    # React components (Header, Footer, etc.)
  styles/        # CSS and styling
  lib/           # Utilities and helpers
\`\`\`

Key components:
- Header.tsx - Navigation and site header
- Footer.tsx - Site footer with contact info
- ContactSection.tsx - Contact form and info
- ClassesSection.tsx - Dance class listings

## About NDCE
- Family-oriented dance studio in Lutz, FL
- Founded in 2013 by Nicole Bouchard
- Offers classes for ages 3+ through adults
- Styles: Ballet, Tap, Jazz, Hip Hop, Lyrical, Contemporary, and more

## When You're Done (FOLLOW THIS EXACTLY)

After making changes with write_file, edit_file, or apply_find_replace, ALWAYS end with this format:

"I've **STAGED** the following changes for your review:
- [List each file modified]

⚠️ **These changes are NOT live yet.** They are in the staging area waiting for your approval.

👉 **Next step:** Click the **'Approve & Publish'** button in the panel on the right to make these changes live on your website."

⛔ **NEVER say:**
- "Changes are live" or "published" or "deployed"
- "Your website has been updated"
- The rocket emoji 🚀 with claims of publishing

The user MUST click "Approve & Publish" - until then, nothing has changed on the actual website.`
