// Tool definitions for the NDCE AI Assistant
// These tools give the assistant Claude Code-like capabilities

import Anthropic from '@anthropic-ai/sdk'
import { listFiles as ghListFiles, getFileContent, updateFile, searchInFiles, isGitHubAvailable } from './github'
import { getAllGenericPendingChanges } from './github-staging'

// Returns the most recent staged version of `path` if any edits to that file
// are already pending in this session. This lets sequential edit_file/write_file
// calls compose: each new edit applies on top of the previous staged content
// instead of fresh-fetching from GitHub (which would lose the earlier change).
function getStagedFileContent(path: string): string | null {
  const pending = getAllGenericPendingChanges()
  for (const change of pending) {
    if (change.path === path && change.content) return change.content
  }
  return null
}

// Build a Headers object that carries the X-Service-Token so internal
// /api/website/* calls authenticate themselves to the new auth guard.
// The token is set in Vercel as WEBSITE_SERVICE_TOKEN. If the env var
// isn't configured the header is simply omitted — useful for local dev
// where the routes aren't gated.
function buildServiceHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  const token = process.env.WEBSITE_SERVICE_TOKEN
  if (token) headers.set('X-Service-Token', token)
  return headers
}

// ============================================================================
// find_visible_concept — deterministic discovery for "remove X" / "update X"
//
// The model is unreliable at remembering to check every page when a user says
// something like "remove the call button". This tool runs a fixed set of
// searches per concept, aggregates the hits, and returns them grouped by the
// kind of artifact (visible JSX vs. SEO/schema vs. data source). The system
// prompt forces the bot to call this BEFORE editing for any request that
// targets a known concept, so the edit-set is computed by code rather than by
// LLM reasoning.
// ============================================================================

type HitKind =
  | 'visible_link'   // <a href="tel:"> etc — what the user sees and clicks
  | 'visible_text'   // hardcoded user-facing strings
  | 'data_source'    // studioInfo.X reference — flows everywhere
  | 'schema_data'    // JSON-LD / metadata — invisible but tells search engines

interface ConceptSearch {
  pattern: string
  kind: HitKind
  why: string
}

interface ConceptDef {
  display: string             // human-readable name shown to user
  aliases: string[]           // alternate keys the bot might pass
  searches: ConceptSearch[]
}

// Each concept lists the literal substrings to grep for and what each match
// represents. Patterns are intentionally narrow (URL prefixes, exact field
// names, hardcoded literals) so we minimize false positives — the bot has to
// trust this list completely.
const CONCEPTS: Record<string, ConceptDef> = {
  call_button: {
    display: 'click-to-call button / phone number',
    aliases: ['phone_number', 'phone', 'call_link', 'click_to_call', 'tel'],
    searches: [
      { pattern: 'tel:', kind: 'visible_link', why: 'Renders a click-to-call link in the page' },
      { pattern: 'studioInfo.phone', kind: 'data_source', why: 'References the studio phone number' },
      { pattern: 'telephone:', kind: 'schema_data', why: 'Schema field that tells Google the phone number' },
    ],
  },
  email: {
    display: 'studio email link',
    aliases: ['email_link', 'mailto', 'contact_email'],
    searches: [
      { pattern: 'mailto:', kind: 'visible_link', why: 'Renders a clickable email link' },
      { pattern: 'studioInfo.email', kind: 'data_source', why: 'References the studio email' },
      { pattern: 'nicolesdancecenter@gmail.com', kind: 'visible_text', why: 'Hardcoded email text on the page' },
      { pattern: 'email:', kind: 'schema_data', why: 'Schema field that tells Google the email' },
    ],
  },
  address: {
    display: 'studio address',
    aliases: ['location', 'street_address'],
    searches: [
      { pattern: 'studioInfo.address', kind: 'data_source', why: 'References the studio address' },
      { pattern: '17743 Hunting Bow', kind: 'visible_text', why: 'Hardcoded street address text' },
      { pattern: 'streetAddress', kind: 'schema_data', why: 'Schema street field that Google reads' },
      { pattern: 'addressLocality', kind: 'schema_data', why: 'Schema city field that Google reads' },
    ],
  },
  hours: {
    display: 'studio operating hours',
    aliases: ['operating_hours', 'studio_hours', 'opening_hours'],
    searches: [
      { pattern: 'studioInfo.hours', kind: 'data_source', why: 'References hours from the studio data' },
      { pattern: 'openingHours', kind: 'schema_data', why: 'Schema field that tells Google when the studio is open' },
    ],
  },
  studio_name: {
    display: 'studio name',
    aliases: ['business_name', 'name'],
    searches: [
      { pattern: 'studioInfo.name', kind: 'data_source', why: 'References the studio name' },
      { pattern: "Nicole's Dance Center Elite", kind: 'visible_text', why: 'Hardcoded full studio name' },
      { pattern: 'NDCE', kind: 'visible_text', why: 'Studio short name' },
    ],
  },
  logo: {
    display: 'studio logo',
    aliases: ['brand_logo', 'site_logo'],
    searches: [
      { pattern: 'nicoles-dance-elite-logo', kind: 'visible_link', why: 'Logo image file reference' },
      { pattern: 'favicon', kind: 'schema_data', why: 'Browser tab icon' },
      { pattern: 'og:image', kind: 'schema_data', why: 'Image shown when the site is shared on social media' },
    ],
  },
}

// Find the JSX element (opening tag through closing tag) that contains
// `hitLine` (1-indexed). We try each common element type in order; the
// first one whose tags actually balance around the hit line wins.
//
// This is intentionally heuristic, not a full JSX parser. It handles
// the cases the bot keeps stumbling on (deleting <a>/<button>/<Link>/<p>
// elements that wrap call buttons, phone text, etc.) where a real
// parser would be overkill.
function findEnclosingJsxRange(
  content: string,
  hitLine: number,
): { startLine: number; endLine: number; tag: string } | null {
  const lines = content.split('\n')
  for (const tag of ['a', 'button', 'Link', 'div', 'p', 'span']) {
    const range = findRangeForTag(lines, hitLine - 1, tag)
    if (range) return { ...range, tag }
  }
  return null
}

function findRangeForTag(
  lines: string[],
  hitLine0: number,
  tag: string,
): { startLine: number; endLine: number } | null {
  // Match `<tag ` or `<tag>` (NOT `<tagx`). Self-closing `<tag />` is
  // intentionally counted as both open and close — for our use case
  // self-closing wrappers don't enclose anything anyway.
  const openRe = new RegExp(`<${tag}(\\s|>)`, 'g')
  const selfCloseRe = new RegExp(`<${tag}[^>]*\\/>`, 'g')
  const closeRe = new RegExp(`</${tag}>`, 'g')

  // Walk forward from start of file, maintaining a stack of unmatched
  // opens. The top of stack at hitLine0 is the enclosing element.
  const stack: number[] = []
  for (let i = 0; i <= hitLine0; i++) {
    const line = lines[i]
    const opens = (line.match(openRe) || []).length
    const selfCloses = (line.match(selfCloseRe) || []).length
    const closes = (line.match(closeRe) || []).length
    // self-closes already counted as opens by openRe; subtract them.
    const realOpens = opens - selfCloses
    for (let o = 0; o < realOpens; o++) stack.push(i)
    for (let c = 0; c < closes; c++) stack.pop()
  }
  if (stack.length === 0) return null

  const startLine0 = stack[stack.length - 1]
  // Walk forward from after hitLine to find the matching close.
  let depth = stack.length
  for (let i = hitLine0 + 1; i < lines.length; i++) {
    const line = lines[i]
    const opens = (line.match(openRe) || []).length
    const selfCloses = (line.match(selfCloseRe) || []).length
    const closes = (line.match(closeRe) || []).length
    depth += (opens - selfCloses) - closes
    if (depth < stack.length) {
      return { startLine: startLine0 + 1, endLine: i + 1 }
    }
  }
  return null
}

// Refuse edit_file calls that look like attempts to micro-edit a JSX element
// instead of deleting it cleanly with delete_jsx_element. The bot has
// repeatedly produced "hollow wrapper" diffs (icon-only delete, inner-text
// delete, href neutered to "#") that leave a still-rendering button.
//
// Returns a refusal string to send back as the tool result, or null if the
// edit should proceed.
export function detectHollowJsxEdit(
  path: string,
  oldContent: string,
  newContent: string,
): string | null {
  // We only police .tsx / .jsx files. Schema-data and config files (.ts, .js,
  // .json) often legitimately contain `tel:` or `phone` strings that should
  // be edited rather than deleted as JSX elements.
  if (!path.endsWith('.tsx') && !path.endsWith('.jsx')) return null

  const oldHasTel = /\btel:/.test(oldContent)
  const oldHasMailto = /\bmailto:/.test(oldContent)
  const oldHasPhoneIcon = /<PhoneIcon\b/.test(oldContent)
  const oldHasJsxOpen = /<[A-Za-z][^>]*>/.test(oldContent)
  const newIsEmpty = newContent.trim() === ''
  const newHasMatchingClose = /<\/[A-Za-z]/.test(newContent)
  const oldHasMatchingClose = /<\/[A-Za-z]/.test(oldContent)

  // Pattern 1: oldContent contains a tel:/mailto: link or PhoneIcon, but
  // newContent is non-empty AND doesn't contain the same tokens —
  // the model is keeping the wrapper and trimming the contents.
  if (
    (oldHasTel || oldHasMailto || oldHasPhoneIcon) &&
    !newIsEmpty &&
    !/\btel:|\bmailto:|<PhoneIcon\b/.test(newContent)
  ) {
    return [
      `❌ edit_file refused on ${path}.`,
      ``,
      `This looks like a partial deletion of a JSX element: oldContent contains`,
      `\`tel:\`, \`mailto:\`, or \`<PhoneIcon>\`, and newContent strips it but`,
      `keeps surrounding JSX. That leaves a hollow wrapper still rendering as a`,
      `button on the page — exactly the bug we keep seeing.`,
      ``,
      `Use \`delete_jsx_element\` instead. Pick a unique substring inside the`,
      `element (the full \`tel:\${...}\` template, a unique className, or a`,
      `unique inner text), and the tool will delete the whole element from`,
      `opening tag through closing tag.`,
      ``,
      `Example:`,
      `delete_jsx_element({`,
      `  path: "${path}",`,
      `  locator: "tel:\${studioInfo.phone",`,
      `  description: "remove call button"`,
      `})`,
    ].join('\n')
  }

  // Pattern 2: oldContent has a JSX opening tag with a matching close, and
  // newContent has no closing tag — likely a broken-JSX edit (e.g.
  // `defaultValue={...}` → `defaultValue=`).
  if (oldHasJsxOpen && oldHasMatchingClose && !newIsEmpty && !newHasMatchingClose) {
    // Heuristic check: did the model leave a dangling attribute (`attr=` with
    // no value) or unmatched braces?
    const dangling = /=\s*$/m.test(newContent) || /\{[^}]*$/.test(newContent)
    if (dangling) {
      return [
        `❌ edit_file refused on ${path}.`,
        ``,
        `newContent looks like broken JSX — there's a dangling attribute`,
        `assignment or unmatched brace. This produces invalid syntax and`,
        `breaks the build.`,
        ``,
        `If you're trying to delete an element, use \`delete_jsx_element\`.`,
        `If you're trying to remove a single attribute, edit the entire`,
        `opening tag — don't leave \`attr=\` with no value.`,
      ].join('\n')
    }
  }

  // Pattern 3: oldContent is a tight slice of a `Call ${...}` template literal
  // that the model is trying to neuter. Easy tell: oldContent contains the
  // word "Call" inside a template literal context but doesn't include the
  // surrounding JSX element.
  const oldHasCallText = /\bCall\s+\{|\bCall\s+\$\{/.test(oldContent)
  if (oldHasCallText && !oldHasMatchingClose && !newIsEmpty) {
    return [
      `❌ edit_file refused on ${path}.`,
      ``,
      `This edit only modifies the inner text "Call {phone}" but leaves the`,
      `wrapping JSX element intact — the result still renders a button.`,
      ``,
      `Use \`delete_jsx_element\` with a locator inside the call button (e.g.`,
      `the \`tel:\` template literal or the element's className) to delete the`,
      `whole element at once.`,
    ].join('\n')
  }

  return null
}

function resolveConcept(input: string): { key: string; def: ConceptDef } | null {
  const norm = input.toLowerCase().replace(/[\s\-]+/g, '_')
  if (CONCEPTS[norm]) return { key: norm, def: CONCEPTS[norm] }
  for (const [key, def] of Object.entries(CONCEPTS)) {
    if (def.aliases.includes(norm)) return { key, def }
  }
  return null
}

interface AggregatedHit {
  file: string
  line: number
  snippet: string
  kind: HitKind
  why: string
}

async function findVisibleConcept(input: string): Promise<string> {
  const resolved = resolveConcept(input)
  if (!resolved) {
    const known = Object.keys(CONCEPTS).join(', ')
    return `Unknown concept "${input}". Known concepts: ${known}.\n\nIf the user is asking about something not in this list, fall back to search_source_code with a specific literal string they mentioned. Do NOT free-associate — search only for things you can verify exist.`
  }

  const { def } = resolved

  // Run all searches against main in parallel for speed.
  const mainSearchResults = await Promise.all(
    def.searches.map(async (s) => {
      try {
        const matches = await searchInFiles(s.pattern, false)
        return matches.map((m) => ({
          file: m.path,
          line: m.line,
          snippet: m.content.trim().substring(0, 140),
          kind: s.kind,
          why: s.why,
        } as AggregatedHit))
      } catch {
        return []
      }
    }),
  )

  // Also search the staged copies the bot has produced so far in this
  // session. If the bot already deleted a reference via edit_file, the
  // hit on main is no longer accurate — we want the post-edit view so
  // the bot can verify its own work, not a stale snapshot.
  const stagedFiles = new Map<string, string>()
  for (const change of getAllGenericPendingChanges()) {
    if (change.path && change.content) stagedFiles.set(change.path, change.content)
  }

  const stagedSearchHits: AggregatedHit[] = []
  for (const [path, content] of stagedFiles) {
    const lines = content.split('\n')
    for (const s of def.searches) {
      const needle = s.pattern.toLowerCase()
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(needle)) {
          stagedSearchHits.push({
            file: path,
            line: idx + 1,
            snippet: line.trim().substring(0, 140),
            kind: s.kind,
            why: s.why + ' (in staged content)',
          })
        }
      })
    }
  }

  // Merge: for any file that has staged content, drop the main hits for
  // that file and use the staged hits. Files without staged edits keep
  // their main hits.
  const merged: AggregatedHit[] = []
  for (const group of mainSearchResults) {
    for (const hit of group) {
      if (stagedFiles.has(hit.file)) continue
      merged.push(hit)
    }
  }
  merged.push(...stagedSearchHits)

  // Dedupe (file:line keys), skip backup folders.
  const seen = new Set<string>()
  const hits: AggregatedHit[] = []
  for (const hit of merged) {
    if (hit.file.startsWith('backups/')) continue
    const key = `${hit.file}:${hit.line}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push(hit)
  }

  if (hits.length === 0) {
    if (stagedFiles.size > 0) {
      return `✅ All references for "${def.display}" have been removed in your staged edits. You're ready to finish — respond to the user with a summary of what changed and tell them to click Preview.`
    }
    return `No references found for "${def.display}". Either the concept is already removed or the user is describing something else. Ask them to clarify with a screenshot or specific page name.`
  }

  // Group by kind so the bot sees the structure (visible vs data vs schema).
  const byKind: Record<HitKind, AggregatedHit[]> = {
    visible_link: [],
    visible_text: [],
    data_source: [],
    schema_data: [],
  }
  for (const h of hits) byKind[h.kind].push(h)

  const sections: string[] = []
  const order: Array<[HitKind, string]> = [
    ['visible_link', 'VISIBLE links / buttons (these are what the user sees)'],
    ['visible_text', 'VISIBLE hardcoded text'],
    ['data_source', 'DATA SOURCE (changing this propagates everywhere)'],
    ['schema_data', 'SEARCH-ENGINE DATA (invisible but tells Google)'],
  ]
  for (const [kind, label] of order) {
    if (byKind[kind].length === 0) continue
    sections.push(`### ${label}`)
    for (const h of byKind[kind]) {
      sections.push(`- **${h.file}:${h.line}** — ${h.why}\n  \`${h.snippet}\``)
    }
  }

  const fileCount = new Set(hits.map((h) => h.file)).size

  return [
    `## Discovery: ${def.display}`,
    ``,
    `Found **${hits.length} reference(s) across ${fileCount} file(s)** that you must edit to fully complete this request.`,
    ``,
    sections.join('\n'),
    ``,
    `---`,
    `### What you MUST do next`,
    ``,
    `1. Read each file in the list above (use read_file)`,
    `2. Stage an edit_file for each one — the user will see one combined preview`,
    `3. DO NOT respond to the user with "I've staged the change" until every entry above has a corresponding edit_file or apply_find_replace call.`,
    `4. If a file appears here that you don't intend to touch, you MUST explain why in your final reply.`,
    ``,
    `Half-finished edit-sets are worse than nothing — Nicole will see a half-broken site (e.g. one call button removed, four still live). Be exhaustive.`,
  ].join('\n')
}

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
    name: 'delete_jsx_element',
    description: 'PREFERRED tool for "remove this clickable element" requests (call buttons, links, etc.). Finds the enclosing JSX element around a unique locator string and DELETES the entire element from opening tag through closing tag in one shot. Use this instead of edit_file whenever the user asks to delete a button/link/element — edit_file lets you make subtle micro-edits that leave a hollow wrapper rendering an empty button. This tool does not give you that option; it deletes the whole thing or fails clean.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the repo root, e.g. "src/app/page.tsx".',
        },
        locator: {
          type: 'string',
          description: 'A unique substring that appears INSIDE the element you want to delete. Good locators: a tel: href, a specific className combination, a unique inner text. Must be unique enough to match exactly one element.',
        },
        description: {
          type: 'string',
          description: 'A short human-readable note about what is being deleted, e.g. "homepage CTA call button".',
        },
      },
      required: ['path', 'locator', 'description'],
    },
  },
  {
    name: 'find_visible_concept',
    description: 'REQUIRED before any "remove X" or "update X" request that targets a recognizable visible element of the website (call button, phone number, email link, address, hours, studio name, logo). Returns the COMPLETE list of code locations you must edit to fully satisfy the request — across visible JSX, hardcoded text, data sources, and search-engine schema. Use this instead of guessing or relying on the user\'s location words. After calling this, you must edit every entry in the result.',
    input_schema: {
      type: 'object' as const,
      properties: {
        concept: {
          type: 'string',
          description: 'A canonical concept name. Supported: call_button, phone_number, email, address, hours, studio_name, logo. (Synonyms like "phone", "click_to_call", "mailto", "location", "operating_hours", "business_name", "brand_logo" are also accepted.)',
        },
      },
      required: ['concept'],
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
          headers: buildServiceHeaders({ 'Content-Type': 'application/json' }),
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
          headers: buildServiceHeaders({ 'Content-Type': 'application/json' }),
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
          headers: buildServiceHeaders({ 'Content-Type': 'application/json' }),
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
          headers: buildServiceHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ find: findText, replace: replaceText, preview: false }),
        })
        const data = await response.json()
        if (!data.success) {
          return `Failed to apply changes: ${data.message || 'Unknown error'}`
        }
        if (data.matchCount === 0) {
          return `No matches found for "${findText}". No changes were made.`
        }
        const summary = `✅ **Find & Replace - STAGED (NOT LIVE)**\n\nReplaced ${data.matchCount} occurrence(s) in ${data.filesAffected} file(s).\n\n**Staging ID:** ${data.stagingId || 'N/A'}\n\n⚠️ **IMPORTANT:** These changes are in the staging area only. They will NOT appear on the website until the user clicks Preview, reviews the staging deployment, then clicks Publish to Live.\n\n📋 Tell the user: "I've staged these changes. Please click Preview to build a staging deployment, then Publish to Live to push it."`
        // Embed prepared file contents so the route can pass them directly to publish,
        // bypassing the in-memory staging store that doesn't survive serverless cold starts.
        if (Array.isArray(data.files) && data.files.length > 0) {
          return `${summary}\n\n<staging_payload>${JSON.stringify({ files: data.files })}</staging_payload>`
        }
        return summary
      }

      case 'search_source_code': {
        const { searchText } = toolInput as { searchText: string }
        const response = await fetch(`${baseUrl}/api/website/find-replace?q=${encodeURIComponent(searchText)}`, {
          headers: buildServiceHeaders(),
        })
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

      case 'find_visible_concept': {
        const { concept } = toolInput as { concept: string }
        if (!concept) {
          return `Error: "concept" parameter is required. Supported concepts: ${Object.keys(CONCEPTS).join(', ')}.`
        }
        return await findVisibleConcept(concept)
      }

      case 'delete_jsx_element': {
        if (!isGitHubAvailable()) {
          return 'Error: GitHub integration is not configured.'
        }
        const { path, locator, description } = toolInput as {
          path: string
          locator: string
          description: string
        }
        if (!path || !locator) {
          return 'Error: both "path" and "locator" are required.'
        }
        try {
          // Get latest content — staged version takes precedence so multiple
          // delete calls on the same file compose correctly.
          const stagedContent = getStagedFileContent(path)
          let content: string
          let sha: string
          if (stagedContent !== null) {
            content = stagedContent
            try {
              const fresh = await getFileContent(path)
              sha = fresh.sha
            } catch {
              sha = ''
            }
          } else {
            const fresh = await getFileContent(path)
            content = fresh.content
            sha = fresh.sha
          }

          // Find unique locator line.
          const lines = content.split('\n')
          const matches: number[] = []
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(locator)) matches.push(i)
          }
          if (matches.length === 0) {
            return `Error: locator "${locator}" not found in ${path}. The file may already have been edited. Call read_file to see current content.`
          }
          if (matches.length > 1) {
            return `Error: locator "${locator}" matched ${matches.length} lines in ${path}. The locator must be unique to one element. Lines: ${matches.map(m => m + 1).join(', ')}. Try a more specific substring (e.g. include surrounding className or attribute values).`
          }
          const hitLine = matches[0] + 1 // 1-indexed for findEnclosingJsxRange

          const range = findEnclosingJsxRange(content, hitLine)
          if (!range) {
            return `Error: could not find an enclosing JSX element around "${locator}" in ${path}. The locator may not be inside an <a>/<button>/<Link>/<p>/<div>/<span>. Use edit_file with explicit oldContent instead.`
          }

          // Compute deleted span (for confirmation) and new content.
          const deletedSnippet = lines.slice(range.startLine - 1, range.endLine).join('\n')
          const before = lines.slice(0, range.startLine - 1)
          const after = lines.slice(range.endLine)
          const newContent = [...before, ...after].join('\n')

          // Stage via /api/website/file-operation.
          const response = await fetch(`${baseUrl}/api/website/file-operation`, {
            method: 'POST',
            headers: buildServiceHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              operation: 'edit',
              path,
              content: newContent,
              sha,
              description: description || `Delete <${range.tag}> element in ${path}`,
            }),
          })
          const data = await response.json()
          if (!data.success) {
            return `Failed to stage delete: ${data.message || 'Unknown error'}`
          }

          const summary = [
            `✅ Deleted <${range.tag}> element from ${path} (lines ${range.startLine}–${range.endLine}) - STAGED (NOT LIVE)`,
            ``,
            `**Deleted:**`,
            '```jsx',
            deletedSnippet,
            '```',
            ``,
            `**Description:** ${description || '(none)'}`,
            `**Staging ID:** ${data.stagingId || 'N/A'}`,
            ``,
            `⚠️ This change is in staging only. After staging all your deletes, call find_visible_concept to verify nothing was missed, then tell the user to click Preview.`,
          ].join('\n')

          // Embed staging payload so the route can publish directly without
          // depending on the in-memory staging store across cold starts.
          return `${summary}\n\n<staging_payload>${JSON.stringify({ files: [{ path, newContent, sha }] })}</staging_payload>`
        } catch (error) {
          return `Error deleting element from "${path}": ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }

      case 'get_staged_changes': {
        const response = await fetch(`${baseUrl}/api/website/publish`, {
          headers: buildServiceHeaders(),
        })
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
          // If this file already has a pending staged edit, read THAT so the
          // assistant sees its own in-progress changes instead of stale main.
          const stagedContent = getStagedFileContent(path)
          let content: string
          let sha: string
          let stagingNote = ''
          if (stagedContent !== null) {
            content = stagedContent
            try {
              const fresh = await getFileContent(path)
              sha = fresh.sha
            } catch {
              sha = ''
            }
            stagingNote = '\n**Note:** Reading staged content (this file has pending edits in this session).'
          } else {
            const fresh = await getFileContent(path)
            content = fresh.content
            sha = fresh.sha
          }

          // Add line numbers for easier reference. IMPORTANT: the leading
          // "NN | " prefix is display-only — it is NOT part of the file's
          // bytes and must be stripped before passing text to edit_file.
          const lines = content.split('\n')
          const numberedContent = lines.map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`).join('\n')

          return `## File: ${path}\n\n**SHA:** ${sha}\n**Lines:** ${lines.length}${stagingNote}\n\n⚠️ The "NN | " prefix on each line below is for reading only. **DO NOT** include it in edit_file's oldContent — strip the prefix and pass only the actual file text.\n\n\`\`\`\n${numberedContent}\n\`\`\``
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
            headers: buildServiceHeaders({ 'Content-Type': 'application/json' }),
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
            return `✅ **File ${action} - STAGED (NOT LIVE)**\n\n**Path:** ${path}\n**Description:** ${description}\n**Lines:** ${content.split('\n').length}\n**Staging ID:** ${data.stagingId || 'N/A'}\n\n⚠️ **IMPORTANT:** This change is in the staging area only. It will NOT appear on the website until the user clicks Preview, reviews the staging deployment, then clicks Publish to Live.\n\n📋 Tell the user: "I've staged these changes. Please click Preview to build a staging deployment, then Publish to Live to push it."`
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

        // Guard: refuse JSX-element micro-edits that leave a hollow wrapper.
        // The model has repeatedly tried to "delete" a call button by stripping
        // the icon, the inner text, or the href value — leaving the surrounding
        // <a>/<button> still rendering as a button. Force it onto delete_jsx_element.
        const refusal = detectHollowJsxEdit(path, oldContent, newContent)
        if (refusal) {
          return refusal
        }

        try {
          // If a prior tool call already staged an edit to this file in the same
          // session, build on top of that staged content. Otherwise pull fresh
          // from GitHub. SHA always tracks the GitHub HEAD so the eventual
          // commit replaces the right blob.
          const stagedContent = getStagedFileContent(path)
          let currentContent: string
          let sha: string
          if (stagedContent !== null) {
            currentContent = stagedContent
            try {
              const fresh = await getFileContent(path)
              sha = fresh.sha
            } catch {
              sha = ''
            }
          } else {
            const fresh = await getFileContent(path)
            currentContent = fresh.content
            sha = fresh.sha
          }

          // Defense in depth: if oldContent looks like it was copied from
          // read_file's numbered display ("  NN | actual line"), strip the
          // prefix so the match has a chance to succeed even if the model
          // forgot to do it.
          const looksLikeNumberedLines = oldContent.split('\n').every(l => /^\s*\d+\s*\|\s/.test(l) || l === '')
          const normalizedOld = looksLikeNumberedLines
            ? oldContent.split('\n').map(l => l.replace(/^\s*\d+\s*\|\s?/, '')).join('\n')
            : oldContent

          // Check if old content exists
          let effectiveOld: string
          if (currentContent.includes(oldContent)) {
            effectiveOld = oldContent
          } else if (normalizedOld !== oldContent && currentContent.includes(normalizedOld)) {
            effectiveOld = normalizedOld
          } else {
            return `Error: Could not find the specified text in "${path}".\n\nThe text you're looking for:\n\`\`\`\n${oldContent}\n\`\`\`\n\nMake sure to use the exact text including whitespace, and DO NOT include the "NN | " line-number prefix from read_file output. Use read_file first to see the current content.`
          }

          // Create the new content
          const updatedContent = currentContent.replace(effectiveOld, newContent)

          // Stage the edit operation
          const response = await fetch(`${baseUrl}/api/website/file-operation`, {
            method: 'POST',
            headers: buildServiceHeaders({ 'Content-Type': 'application/json' }),
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
            const summary = `✅ **File Edit - STAGED (NOT LIVE)**\n\n**Path:** ${path}\n**Description:** ${description}\n**Staging ID:** ${data.stagingId || 'N/A'}\n\n**Change Preview:**\n- Removed: \`${oldContent.substring(0, 100)}${oldContent.length > 100 ? '...' : ''}\`\n- Added: \`${newContent.substring(0, 100)}${newContent.length > 100 ? '...' : ''}\`\n\n⚠️ **IMPORTANT:** This change is in the staging area only. It will NOT appear on the website until the user clicks Preview, reviews the staging deployment, then clicks Publish to Live.\n\n📋 Tell the user: "I've staged these changes. Please click Preview to build a staging deployment, then Publish to Live to push it."`
            // Pass the full updated content via staging payload so the publish call
            // can commit directly without depending on the in-memory store.
            return `${summary}\n\n<staging_payload>${JSON.stringify({ files: [{ path, newContent: updatedContent, sha: sha || '' }] })}</staging_payload>`
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
- ✅ "Click **Preview** in the panel on the right — you'll get a live preview URL of the site WITH these changes applied"
- ✅ "Once the preview looks right, click **Publish to Live** to push it to the production site"
- ✅ "The changes are ready for your approval but NOT yet on the live site"

This is extremely important - users get confused when told something is live but they can't see it.

## Action discipline (READ THIS)

You have a hard turn budget. Every tool call costs a turn. Information
gathering is cheap if it converges — but if you find yourself searching,
re-searching, or re-reading the same file, **STOP** and commit to an
edit_file call. The user is watching a "Thinking…" spinner during all of
this; your job is to make the change, not to be exhaustively certain.

Concrete rules:
- After read_file succeeds for the file you intend to edit, your next
  action should be edit_file. Do NOT search again to "double-check".
- One read_file per file is enough. If you've already read a file in
  this conversation, read its content from the staged copy by using
  read_file again only if you need to see the post-edit state.
- search_source_code is for *finding the file*. Stop searching the
  moment you have a path that contains the target — read_file then
  edit_file.
- If the user gave you the file path in their request, skip search
  entirely and go straight to read_file → edit_file.
- If you can't find what the user described after 2 searches, do not
  keep searching. Tell the user "I couldn't locate that — can you
  point me at the file or paste a screenshot?" and stop.

## ⛔ MANDATORY for "remove this element" requests: use delete_jsx_element ⛔

When find_visible_concept returns a hit of kind \`visible_link\`
(typically a click-to-call \`<a href="tel:">\` or a \`<Link>\` button)
and the user wants that element GONE, you MUST use
\`delete_jsx_element\` instead of edit_file.

Why: edit_file lets you choose any \`oldContent\` boundary, and the
model has repeatedly chosen too-narrow boundaries — deleting just
the icon, just the inner text, or just the href value — leaving a
hollow wrapping \`<a>\` that still renders as a button. Users see
that as "you didn't actually remove it." \`delete_jsx_element\` does
not give you that option; it parses the JSX and removes the entire
element (opening tag → contents → closing tag) deterministically.

Call signature:
\`\`\`
delete_jsx_element({
  path: "src/app/page.tsx",
  locator: "tel:${'$'}{studioInfo.phone",     // or another unique substring inside the element
  description: "homepage CTA call button"
})
\`\`\`

The locator must appear inside the element you want gone, and must
be unique to that one element in the file. Good locators: the full
\`tel:\` template literal, a unique \`className\` value, a unique inner
text. Avoid generic substrings that match in multiple places.

Use edit_file ONLY for:
- Schema-data hits (e.g. \`telephone: studioInfo.phone\` in JSON-LD —
  you replace it with empty/placeholder, you don't delete the
  surrounding object property).
- Data-source edits (e.g. flipping \`phone: "(813) 551-7859"\` →
  \`phone: ""\` in studio.ts).
- Visible-text hits where only a substring of a string literal needs
  to change.

## How to actually delete a JSX element with edit_file

When the user says "remove the call button," your edit_file call's
\`oldContent\` MUST encompass the entire JSX element from its opening
tag through its closing tag. You may NOT pass a tiny \`oldContent\`
that only deletes a piece inside the element. That leaves the
wrapping element rendering an empty version of itself, which the
user sees and tells you to fix.

### Correct edit_file call (DELETE the call button)

\`oldContent\`:
\`\`\`jsx
            <a
              href={\`tel:\${studioInfo.phone.replace(/[^0-9]/g, '')}\`}
              className="btn-primary text-lg flex items-center justify-center gap-2"
            >
              <PhoneIcon className="h-5 w-5" />
              Call {studioInfo.phone}
            </a>
\`\`\`

\`newContent\` (empty string — the entire element is gone):
\`\`\`
\`\`\`

### Incorrect (DO NOT DO THIS)

These patterns are forbidden — every one was a real bug:

| Wrong oldContent | Why it's wrong |
| --- | --- |
| Just \`<PhoneIcon />\` | Leaves \`<a href="tel:">Call {phone}</a>\` rendering "Call " — still a button-shaped element |
| Just \`{studioInfo.phone}\` | Leaves "Call " with a phone icon — still looks like a call button |
| Just \`href={\`tel:...\`}\` → \`href="#"\` | Redirect, not delete — user explicitly said "remove" |
| \`defaultValue={studioInfo.phone}\` → \`defaultValue=\` | Broken JSX — produces invalid syntax |
| \`Call \${studioInfo.phone}\` → \`Call \` | Leaves stray "Call" / "$" garbage in template literals |

### Rule of thumb

If you're tempted to make a 5-character edit to "fix" a deletion
request, you're doing it wrong. The right edit_file is usually
6+ lines of \`oldContent\` and an empty \`newContent\`.

After every delete, the file should have ONE FEWER complete JSX
element — not just a hollowed-out version of the same one.

## "Remove" means DELETE — not redirect, not hide, not relabel

When the user says "remove the call button" / "remove the phone link" /
"take out the address" — they mean **delete the entire element from the
JSX**. They do NOT mean:

- ❌ Change the \`href\` to point somewhere else (e.g. \`tel:...\` → \`/contact\`)
- ❌ Replace the link with placeholder text
- ❌ Hide it with CSS classes
- ❌ Set the data field to empty string and leave the JSX rendering an empty version

The correct edit is to remove the entire \`<a>\` / \`<button>\` / \`<p>\` /
component, including:
1. Its opening and closing tags
2. Any icon component nested inside (e.g. \`<PhoneIcon />\`, \`<MapPinIcon />\`)
3. Any label text inside (e.g. "Call {studioInfo.phone}")
4. Any wrapper that exists ONLY to hold the deleted element (if a \`<div>\`
   contained just the deleted button, delete the div too)

If the user wants a redirect or relabel, they will say "change the call
button to go to the contact form" or "rename Call to Contact Us" —
explicitly. Don't guess.

## After deleting an element, check for orphaned siblings

When you delete one element from a button group / nav / row, the
remaining elements often need adjustment:

- **Sole-button cleanup:** If a \`<div className="flex gap-4">\` contained
  two buttons and you delete one, the remaining single button is now
  in a flex container that no longer makes sense. The user will see it
  as "off-center" or "weirdly spaced." Either remove the flex wrapper
  or note this in your reply so the user knows to re-prompt.
- **Redundant CTA:** If two buttons in the same section pointed to the
  same destination (e.g. a "Call" button and a "Send Message" button
  both on the contact page), deleting one might make the other
  redundant in different ways. Mention this to the user: "I also
  noticed both buttons in the homepage CTA pointed to the contact
  form — want me to drop one of them?"
- **Orphaned icon import:** If you delete the only usage of \`<PhoneIcon />\`
  in a file, the \`PhoneIcon\` import at the top is now unused. Remove it
  from the import statement so the build doesn't warn.

## ⛔ MANDATORY FIRST CALL FOR CONCEPT-LEVEL EDITS ⛔

If the user's request mentions a recognizable visible thing on the
website — a call/phone button, an email link, the studio address,
operating hours, the studio name, or the logo — your FIRST tool call
**MUST** be \`find_visible_concept\` with the matching concept key.
Examples:

| User says | First tool call |
| --- | --- |
| "remove the call button from the footer" | \`find_visible_concept({concept: "call_button"})\` |
| "the studio email changed to ..." | \`find_visible_concept({concept: "email"})\` |
| "we moved — new address is ..." | \`find_visible_concept({concept: "address"})\` |
| "update the hours" | \`find_visible_concept({concept: "hours"})\` |
| "rebrand the studio name to ..." | \`find_visible_concept({concept: "studio_name"})\` |
| "swap the logo to this image" | \`find_visible_concept({concept: "logo"})\` |

The tool returns the COMPLETE list of files you must touch, grouped
into visible JSX, hardcoded text, data sources, and search-engine
schema. **You may not stage your final edit set until every entry on
that list has a corresponding edit_file or apply_find_replace call.**

### Verify your work — call find_visible_concept AGAIN after staging

After all your edit_file calls succeed, call \`find_visible_concept\`
**a second time** with the same concept. The tool now reads from your
staged content and will tell you what's left.

- If it returns "✅ All references … have been removed" → respond
  to the user with a summary, mention the Preview button, done.
- If it still returns hits → your edits were too narrow. Look at the
  hit's snippet, find the enclosing JSX element, and re-edit with a
  broader \`oldContent\` that includes the entire element (opening
  tag → contents → closing tag). Then verify again.

This second call is cheap and catches the most common failure mode:
deleting an icon or interpolation but leaving the wrapping \`<a>\`
element rendering an empty version of itself.

Do NOT skip this tool because you "already know where the call button
is" or because the user named a single page. The user will name one
page; the bot will edit one page; the site will be left half-broken
in five other places. find_visible_concept is the only thing
preventing that failure mode.

If the user asks for something not covered by find_visible_concept
(e.g. "add a new section", "change the button color"), you don't need
to call it — proceed normally with search_source_code / read_file /
edit_file.

## Speak human — the user is a non-technical small-business owner

Nicole runs a dance studio. She does NOT know what a component is, what a
JSX file is, or what JSON-LD / structured data / schema markup is. She
will describe what she SEES on the page, not the file that renders it.

Your job is to translate her words into the full set of technical edits
required, AND to do them all in one pass. Never make her ask for the
"technical" parts separately.

### Translation table — what visible things actually touch

| User says | You must edit |
| --- | --- |
| "the call button" / "click-to-call" / "the phone number link" | Every \`<a href="tel:...">\` across the site (homepage CTA, schedule, classes, contact, footer) AND \`telephone\` fields in StructuredData.tsx AND \`studioInfo.phone\` in studio.ts (set to "" or remove) |
| "the phone number" | Same as above |
| "the logo" | Every \`<Image src=...>\` referencing the logo, the favicon in app/layout, and og:image / Twitter card images in metadata |
| "the address" | \`studioInfo.address.*\` AND any \`address\` fields in StructuredData.tsx AND any hardcoded address strings in pages |
| "the studio hours" | \`studioInfo.hours\` AND any \`openingHours\` in StructuredData.tsx AND any hours rendered statically in pages |
| "the email" | \`studioInfo.email\` AND any \`mailto:\` links AND \`email\` field in StructuredData.tsx |
| "the studio name" | \`studioInfo.name\` AND \`name\` in StructuredData.tsx AND \`<title>\` and metadata.title in app/layout |
| "the navigation" / "the menu" | Header.tsx (and any mobile nav variant) |

### Discovery rules — find ALL of it before editing ANYTHING

1. Treat the user's LOCATION words ("in the footer", "on the homepage",
   "next to the schedule") as HINTS, NOT constraints. The actual element
   she's seeing might be rendered from a different file.

2. For ANY remove/replace/update request that touches a recognizable
   visible element (button, link, image, section, contact info, hours):
   START with search_source_code across the WHOLE codebase. Find every
   instance. Only then plan the edits.

3. If you find more than one occurrence, list them in your reply BEFORE
   making any edit_file call:

   > "Removing the call-to-action phone button — I see it in 5 places:
   > Homepage CTA, Schedule page, Classes page, Contact page, Footer,
   > and the structured-data block that tells Google our phone number.
   > I'll remove all six in one preview."

4. Then make all the edits as a single staged change set — Nicole will
   click Preview ONCE and see every change at once. Never partial-edit
   "the footer one" while leaving the homepage CTA alone — that produces
   a half-finished site she can see is broken.

5. Schema / SEO / structured data updates are AUTOMATIC side effects of
   visible-element edits. NEVER ask "do you also want to update the
   structured data?" — Nicole doesn't know what that is. Just include
   it in the same change set and mention it briefly:

   > "...and I updated the search-engine info so Google won't show the
   > old phone number anymore."

## Picking the right tool for the request

**review_website** ONLY answers content questions ("what does the homepage
say about classes?", "what phone number is on the contact page?"). It
returns prose, NOT styling info. NEVER call review_website for a layout,
styling, color, alignment, or visual question — the response will not
help you fix the issue and you will burn turns.

**Visual / styling / layout requests** ("center this text", "make this
bigger", "change the color of...", "fix any circles with text",
"reformat the buttons"): the user is describing CSS/JSX. Always start
with search_source_code for the most likely Tailwind class or attribute
(e.g. "rounded-full", "text-center", "bg-red-700", "w-16 h-16"). Then
read_file and edit_file the matching components.

**Content / text edits** (phone numbers, ages, typos, copy changes):
search_website or search_source_code for the text → preview_find_replace
→ apply_find_replace.

**Adding sections, components, pages**: list_files → read a similar file
to match style → edit_file (preferred) or write_file.

When in doubt about whether a request is content vs styling, do BOTH:
search_source_code first to see how the thing is rendered, then decide.

## Best Practices

- **Always read before editing**: Use read_file before edit_file to get exact text
- **Make targeted edits**: Use edit_file for small changes, not write_file
- **Preserve code style**: Match the existing indentation and formatting
- **Strip line-number prefixes**: read_file shows content with a "  NN | "
  prefix on each line for human legibility. That prefix is NOT part of
  the file. When passing text to edit_file's oldContent, strip the
  "NN | " prefix and pass only the actual file bytes (matching original
  indentation exactly). If your first edit_file fails with "Could not
  find the specified text", check that you removed the line-number
  prefixes — that's the most common cause.
- **Explain your changes**: Tell the user what you changed and why
- **Compose related changes**: If a single user request needs multiple
  edits to the same file (e.g. add an import AND swap JSX that uses it),
  the engine will stack later edits on top of earlier staged ones — so
  it's safe to issue them sequentially. read_file always returns the
  most recent staged content if any pending edits exist.

## Project Structure (NDCE Website — DJohnsonIronmark/ndce-platform)

\`\`\`
src/
  app/
    (public)/       # Public marketing pages: about, classes, schedule,
                    #   faculty, company, whats-new, photos-videos, contact
    (admin)/        # Admin-side pages (separate from this assistant)
    page.tsx        # Homepage
    layout.tsx      # Root layout
  components/
    layout/         # Header.tsx, Footer.tsx
    seo/            # StructuredData.tsx
  lib/
    data/studio.ts  # Studio info (hours, address, phone, etc.)
    cloudinary/     # Image hosting helpers
    supabase/       # DB client
public/             # Static assets (logos, images)
\`\`\`

Key components:
- src/components/layout/Header.tsx — top nav, branding, mobile menu
- src/components/layout/Footer.tsx — footer with contact info
- src/lib/data/studio.ts — single source of truth for hours, phone, address

When the user asks about a page (e.g. "the classes page"), look in
src/app/(public)/<page>/page.tsx. When they reference contact info,
phone, or hours, prefer editing src/lib/data/studio.ts so the change
flows everywhere it's used.

## About NDCE
- Family-oriented dance studio in Lutz, FL
- Founded in 2013 by Nicole Bouchard
- Offers classes for ages 3+ through adults
- Styles: Ballet, Tap, Jazz, Hip Hop, Lyrical, Contemporary, and more

## When You're Done (FOLLOW THIS EXACTLY)

After making changes with write_file, edit_file, or apply_find_replace, ALWAYS end with this format:

"I've **STAGED** the following changes for your review:
- [List each user-visible thing that changed in plain language — e.g. 'Removed the call button from the homepage, schedule page, classes page, contact page, and footer' — NOT a list of file paths]

⚠️ **These changes are NOT live yet.**

👉 **Next steps:**
1. Click **Preview** in the panel on the right — Vercel will build a temporary preview of the site with these changes (~30–60s)
2. Open the preview link, click around, make sure it looks right
3. Click **Publish to Live** to push to the real site, or **Discard** to throw it away"

⛔ **NEVER say:**
- "Changes are live" or "published" or "deployed"
- "Your website has been updated"
- The rocket emoji 🚀 with claims of publishing

The user MUST click Preview, then Publish to Live — until then, nothing has changed on the actual website.`
