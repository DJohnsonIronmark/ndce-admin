import { NextRequest, NextResponse } from 'next/server'

interface VerifyRequest {
  searchText?: string
  url?: string
  mode?: 'search' | 'review'  // review mode returns full content analysis
}

interface TextMatch {
  text: string
  context: string
  count: number
}

interface ContentSection {
  name: string
  content: string
}

interface SiteReview {
  title: string
  sections: ContentSection[]
  keyInfo: {
    ages?: string[]
    phoneNumbers?: string[]
    emails?: string[]
    addresses?: string[]
  }
  fullText: string
  wordCount: number
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

// Extract structured content from HTML for review
function extractStructuredContent(html: string): SiteReview {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : 'Unknown'

  // Get full text content
  const fullText = extractTextContent(html)

  // Extract sections based on common patterns
  const sections: ContentSection[] = []

  // Look for hero/header content
  const heroMatch = html.match(/<(?:section|div)[^>]*(?:hero|header|banner)[^>]*>([\s\S]*?)<\/(?:section|div)>/i)
  if (heroMatch) {
    sections.push({ name: 'Hero/Header', content: extractTextContent(heroMatch[1]).substring(0, 500) })
  }

  // Look for about section
  const aboutMatch = html.match(/<(?:section|div)[^>]*(?:about|intro)[^>]*>([\s\S]*?)<\/(?:section|div)>/i)
  if (aboutMatch) {
    sections.push({ name: 'About', content: extractTextContent(aboutMatch[1]).substring(0, 500) })
  }

  // Look for programs/classes section
  const programsMatch = html.match(/<(?:section|div)[^>]*(?:program|class|course)[^>]*>([\s\S]*?)<\/(?:section|div)>/i)
  if (programsMatch) {
    sections.push({ name: 'Programs/Classes', content: extractTextContent(programsMatch[1]).substring(0, 500) })
  }

  // Look for contact section
  const contactMatch = html.match(/<(?:section|div)[^>]*(?:contact|footer)[^>]*>([\s\S]*?)<\/(?:section|div)>/i)
  if (contactMatch) {
    sections.push({ name: 'Contact/Footer', content: extractTextContent(contactMatch[1]).substring(0, 500) })
  }

  // If no sections found, create chunks from full text
  if (sections.length === 0) {
    const chunkSize = 500
    for (let i = 0; i < Math.min(fullText.length, 2000); i += chunkSize) {
      sections.push({
        name: `Content ${Math.floor(i / chunkSize) + 1}`,
        content: fullText.substring(i, i + chunkSize)
      })
    }
  }

  // Extract key information
  const keyInfo: SiteReview['keyInfo'] = {}

  // Find age references (ages 2, ages 3, 2 years old, etc.)
  const ageMatches = fullText.match(/ages?\s*\d+|(\d+)\s*(?:years?\s*old|yr|yrs)/gi)
  if (ageMatches) {
    keyInfo.ages = [...new Set(ageMatches.map(m => m.toLowerCase()))]
  }

  // Find phone numbers
  const phoneMatches = fullText.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g)
  if (phoneMatches) {
    keyInfo.phoneNumbers = [...new Set(phoneMatches)]
  }

  // Find email addresses
  const emailMatches = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)
  if (emailMatches) {
    keyInfo.emails = [...new Set(emailMatches)]
  }

  // Word count
  const wordCount = fullText.split(/\s+/).length

  return {
    title,
    sections,
    keyInfo,
    fullText,
    wordCount,
  }
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
    const { searchText, url = NDCE_WEBSITE_URL, mode = 'search' } = body

    // Fetch the website
    const html = await fetchWebsiteContent(url)

    // Review mode - return full structured content analysis
    if (mode === 'review' || (!searchText && !mode)) {
      const review = extractStructuredContent(html)

      return NextResponse.json({
        success: true,
        mode: 'review',
        url,
        review,
        message: `Website review complete. Found ${review.sections.length} sections, ${review.wordCount} words.`,
      })
    }

    // Search mode - look for specific text
    const textContent = extractTextContent(html)

    if (searchText) {
      const match = searchForText(textContent, searchText)

      return NextResponse.json({
        success: true,
        mode: 'search',
        found: match !== null,
        match,
        message: match
          ? `Found "${searchText}" ${match.count} time(s) on the website.`
          : `"${searchText}" was NOT found on the website.`,
      })
    }

    // Default - return summary
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
  const mode = searchParams.get('mode')
  const url = searchParams.get('url') || NDCE_WEBSITE_URL

  try {
    const html = await fetchWebsiteContent(url)

    // Review mode
    if (mode === 'review') {
      const review = extractStructuredContent(html)
      return NextResponse.json({
        success: true,
        mode: 'review',
        url,
        review,
      })
    }

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
