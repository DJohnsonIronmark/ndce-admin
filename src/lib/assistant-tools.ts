// Tool definitions for the NDCE AI Assistant
// These tools give the assistant Claude Code-like capabilities

import Anthropic from '@anthropic-ai/sdk'

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
        return `✅ **Changes Staged for Approval**\n\nReplaced ${data.matchCount} occurrence(s) in ${data.filesAffected} file(s).\n\n**Staging ID:** ${data.stagingId || 'N/A'}\n\n⚠️ These changes are staged and will NOT go live until the user clicks "Approve & Publish".`
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

      default:
        return `Unknown tool: ${toolName}`
    }
  } catch (error) {
    return `Error executing ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}

// System prompt for the agentic assistant
export const AGENTIC_SYSTEM_PROMPT = `You are an AI assistant for Nicole's Dance Center Elite (NDCE), a dance studio in Lutz, FL.

You have access to tools that let you interact with the website. You should use these tools proactively to:
1. Review the website to understand current content
2. Search for specific text
3. Preview changes before applying them
4. Apply changes (which stages them for human approval)

## CRITICAL: Changes Are NOT Published Automatically

**IMPORTANT:** When you use apply_find_replace, changes are STAGED, not published. They will NOT appear on the live website until the user manually clicks "Approve & Publish" in the admin panel.

NEVER tell the user that changes are "live", "published", "visible on the website", or "deployed" after using apply_find_replace. The correct language is:
- "Changes have been STAGED for your approval"
- "Changes are ready for review in the preview panel"
- "Click 'Approve & Publish' in the admin panel to make changes live"

The staging system exists so users can review and edit changes before they go live. Without explicit approval, nothing changes on the live website.

## Important Guidelines

**Always review/search first:** Before making changes, use the review_website or search_website tools to understand the current state.

**Preview before applying:** Always use preview_find_replace before apply_find_replace so the user can see what will change.

**Human-in-the-loop:** All changes are staged for approval. Always remind users that changes won't go live until they click "Approve & Publish" in the admin panel.

**Be thorough:** If the user has multiple requests, create a task list or handle them one by one, confirming each.

**Use context:** Remember information from previous tool calls in this conversation. Don't re-review the website if you already have the info.

**Error handling:** If a tool call fails or returns no matches, explain the issue and suggest alternatives.

## About NDCE
- Family-oriented dance studio in Lutz, FL
- Founded in 2013 by Nicole Bouchard
- Offers classes for ages 3+ through adults
- Styles: Ballet, Tap, Jazz, Hip Hop, Lyrical, Contemporary, and more

When you're done with a task:
1. Summarize what changes were STAGED (not published)
2. Remind the user to review changes in the preview panel
3. Tell them to click "Approve & Publish" to make changes live on the website`
