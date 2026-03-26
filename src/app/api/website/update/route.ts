import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

interface UpdateRequest {
  section: string
  content: string
  backup?: boolean
}

// Website file path (relative to project root)
const WEBSITE_PATH = join(process.cwd(), '..', 'index.html')

// Section markers in the HTML file
const SECTION_MARKERS: Record<string, { start: string; end: string }> = {
  hero: {
    start: '<!-- HERO_START -->',
    end: '<!-- HERO_END -->',
  },
  schedule: {
    start: '<!-- SCHEDULE_START -->',
    end: '<!-- SCHEDULE_END -->',
  },
  announcement: {
    start: '<!-- ANNOUNCEMENT_START -->',
    end: '<!-- ANNOUNCEMENT_END -->',
  },
  about: {
    start: '<!-- ABOUT_START -->',
    end: '<!-- ABOUT_END -->',
  },
}

export async function POST(request: NextRequest) {
  try {
    const body: UpdateRequest = await request.json()
    const { section, content, backup = true } = body

    // Validate section
    if (!SECTION_MARKERS[section]) {
      return NextResponse.json(
        { error: `Unknown section: ${section}. Valid sections: ${Object.keys(SECTION_MARKERS).join(', ')}` },
        { status: 400 }
      )
    }

    // Read current HTML
    let html: string
    try {
      html = await readFile(WEBSITE_PATH, 'utf-8')
    } catch {
      return NextResponse.json(
        { error: 'Could not read website file. Make sure the path is correct.' },
        { status: 500 }
      )
    }

    // Create backup if requested
    if (backup) {
      const backupPath = WEBSITE_PATH.replace('.html', `.backup-${Date.now()}.html`)
      await writeFile(backupPath, html)
    }

    // Find and replace section
    const { start, end } = SECTION_MARKERS[section]
    const startIndex = html.indexOf(start)
    const endIndex = html.indexOf(end)

    if (startIndex === -1 || endIndex === -1) {
      // Section markers don't exist - inform user
      return NextResponse.json({
        success: false,
        message: `Section markers not found in HTML. Add ${start} and ${end} markers to enable automated updates.`,
        manualUpdate: {
          section,
          content,
          instructions: 'Please manually update this section in your HTML file.',
        },
      })
    }

    // Replace content between markers
    const newHtml =
      html.substring(0, startIndex + start.length) +
      '\n' +
      content +
      '\n' +
      html.substring(endIndex)

    // Write updated HTML
    await writeFile(WEBSITE_PATH, newHtml)

    return NextResponse.json({
      success: true,
      message: `Successfully updated ${section} section`,
      section,
    })
  } catch (error) {
    console.error('Website update error:', error)
    return NextResponse.json(
      { error: 'Failed to update website' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const html = await readFile(WEBSITE_PATH, 'utf-8')

    // Extract content from each section
    const sections: Record<string, string | null> = {}

    for (const [name, markers] of Object.entries(SECTION_MARKERS)) {
      const startIndex = html.indexOf(markers.start)
      const endIndex = html.indexOf(markers.end)

      if (startIndex !== -1 && endIndex !== -1) {
        sections[name] = html
          .substring(startIndex + markers.start.length, endIndex)
          .trim()
      } else {
        sections[name] = null
      }
    }

    return NextResponse.json({
      success: true,
      sections,
      availableSections: Object.keys(SECTION_MARKERS),
    })
  } catch {
    return NextResponse.json(
      { error: 'Could not read website file' },
      { status: 500 }
    )
  }
}
