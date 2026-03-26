import { NextRequest, NextResponse } from 'next/server'

interface VerifyRequest {
  searchText?: string
  url?: string
}

interface TextMatch {
  text: string
  context: string
  count: number
}

const NDCE_WEBSITE_URL = 'https://ndce-platform.vercel.app'

// Fetch and parse website content
async function fetchWebsiteContent(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'NDCE-Admin-Verifier/1.0',
    },
    next: { revalidate: 0 }, // Don't cache
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch website: ${response.status}`)
  }

  return response.text()
}

// Extract visible text from HTML
function extractTextContent(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

  // Remove HTML tags but keep content
  text = text.replace(/<[^>]+>/g, ' ')

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim()

  return text
}

// Search for text in content
function searchForText(content: string, searchText: string): TextMatch | null {
  const lowerContent = content.toLowerCase()
  const lowerSearch = searchText.toLowerCase()

  // Count occurrences
  let count = 0
  let pos = 0
  while ((pos = lowerContent.indexOf(lowerSearch, pos)) !== -1) {
    count++
    pos += lowerSearch.length
  }

  if (count === 0) return null

  // Get context around first match
  const firstIndex = lowerContent.indexOf(lowerSearch)
  const contextStart = Math.max(0, firstIndex - 50)
  const contextEnd = Math.min(content.length, firstIndex + searchText.length + 50)
  const context = content.substring(contextStart, contextEnd)

  return {
    text: searchText,
    context: (contextStart > 0 ? '...' : '') + context + (contextEnd < content.length ? '...' : ''),
    count,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: VerifyRequest = await request.json()
    const { searchText, url = NDCE_WEBSITE_URL } = body

    // Fetch the website
    const html = await fetchWebsiteContent(url)
    const textContent = extractTextContent(html)

    // If searchText provided, search for it
    if (searchText) {
      const match = searchForText(textContent, searchText)

      return NextResponse.json({
        success: true,
        found: match !== null,
        match,
        message: match
          ? `Found "${searchText}" ${match.count} time(s) on the website.`
          : `"${searchText}" was NOT found on the website.`,
      })
    }

    // Return summary of page content
    return NextResponse.json({
      success: true,
      contentLength: textContent.length,
      preview: textContent.substring(0, 500) + '...',
      message: 'Website content fetched successfully.',
    })
  } catch (error) {
    console.error('Verify error:', error)
    return NextResponse.json(
      {
        error: 'Failed to verify website content',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// GET endpoint for quick verification checks
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const q = searchParams.get('q')
  const url = searchParams.get('url') || NDCE_WEBSITE_URL

  try {
    const html = await fetchWebsiteContent(url)
    const textContent = extractTextContent(html)

    if (q) {
      const match = searchForText(textContent, q)
      return NextResponse.json({
        success: true,
        found: match !== null,
        match,
        query: q,
      })
    }

    return NextResponse.json({
      success: true,
      url,
      contentLength: textContent.length,
      preview: textContent.substring(0, 300) + '...',
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch website' },
      { status: 500 }
    )
  }
}
