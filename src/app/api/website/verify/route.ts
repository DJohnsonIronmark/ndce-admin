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

// All pages to crawl for complete review
const SITE_PAGES = [
  { name: 'Home', path: '/' },
  { name: 'About', path: '/about' },
  { name: 'Classes', path: '/classes' },
  { name: 'Schedule', path: '/schedule' },
  { name: 'Contact', path: '/contact' },
]

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

// Extract structured content from HTML for review (single page)
function extractStructuredContent(html: string, pageName?: string): SiteReview {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : 'Unknown'

  // Get full text content
  const fullText = extractTextContent(html)

  // Extract sections - include full content, not truncated
  const sections: ContentSection[] = []

  // For single page, just include the full text as one section
  if (pageName) {
    sections.push({ name: pageName, content: fullText })
  } else {
    // Try to extract sections from HTML structure
    // Look for main content area
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    const mainContent = mainMatch ? extractTextContent(mainMatch[1]) : fullText

    // Split into logical chunks (not truncated)
    sections.push({ name: 'Main Content', content: mainContent })
  }

  // Extract key information from full text
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

// Crawl all site pages for comprehensive review
async function crawlAllPages(baseUrl: string): Promise<SiteReview> {
  const allSections: ContentSection[] = []
  const allKeyInfo: SiteReview['keyInfo'] = {
    ages: [],
    phoneNumbers: [],
    emails: [],
    addresses: [],
  }
  let totalWordCount = 0
  let siteTitle = ''
  const allText: string[] = []

  for (const page of SITE_PAGES) {
    try {
      const url = `${baseUrl}${page.path}`
      const html = await fetchWebsiteContent(url)
      const review = extractStructuredContent(html, page.name)

      if (!siteTitle && review.title) {
        siteTitle = review.title
      }

      // Add sections with page name prefix
      review.sections.forEach(section => {
        allSections.push({
          name: `${page.name}`,
          content: section.content,
        })
      })

      // Merge key info
      if (review.keyInfo.ages) {
        allKeyInfo.ages = [...new Set([...(allKeyInfo.ages || []), ...review.keyInfo.ages])]
      }
      if (review.keyInfo.phoneNumbers) {
        allKeyInfo.phoneNumbers = [...new Set([...(allKeyInfo.phoneNumbers || []), ...review.keyInfo.phoneNumbers])]
      }
      if (review.keyInfo.emails) {
        allKeyInfo.emails = [...new Set([...(allKeyInfo.emails || []), ...review.keyInfo.emails])]
      }

      totalWordCount += review.wordCount
      allText.push(review.fullText)
    } catch (error) {
      console.warn(`Failed to fetch ${page.name}:`, error)
      allSections.push({
        name: page.name,
        content: `[Page not accessible]`,
      })
    }
  }

  return {
    title: siteTitle,
    sections: allSections,
    keyInfo: allKeyInfo,
    fullText: allText.join('\n\n---\n\n'),
    wordCount: totalWordCount,
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

    // Review mode - crawl all pages for comprehensive analysis
    if (mode === 'review' || (!searchText && !mode)) {
      const review = await crawlAllPages(url)

      return NextResponse.json({
        success: true,
        mode: 'review',
        url,
        pagesCrawled: SITE_PAGES.map(p => p.name),
        review,
        message: `Website review complete. Crawled ${SITE_PAGES.length} pages, found ${review.wordCount} total words.`,
      })
    }

    // Fetch the main page for other modes
    const html = await fetchWebsiteContent(url)

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
    // Review mode - crawl all pages
    if (mode === 'review') {
      const review = await crawlAllPages(url)
      return NextResponse.json({
        success: true,
        mode: 'review',
        url,
        pagesCrawled: SITE_PAGES.map(p => p.name),
        review,
      })
    }

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
