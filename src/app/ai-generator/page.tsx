'use client'

import { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { Sparkles, Copy, Check, Calendar, RefreshCw } from 'lucide-react'

const danceStyles = [
  'Hip Hop', 'Ballet', 'Jazz', 'Contemporary', 'Tap', 'Lyrical',
  'Acro', 'Musical Theater', 'All Styles'
]

const ageGroups = [
  'Tiny Tots (2-4)', 'Kids (5-8)', 'Tweens (9-12)',
  'Teens (13-17)', 'Adults (18+)', 'All Ages'
]

const contentTypes = [
  { id: 'class_promo', name: 'Class Promotion', description: 'Highlight a specific class' },
  { id: 'event_announcement', name: 'Event Announcement', description: 'Announce recitals, workshops, camps' },
  { id: 'motivation', name: 'Dance Motivation', description: 'Inspirational content' },
  { id: 'behind_scenes', name: 'Behind the Scenes', description: 'Studio life, rehearsals' },
  { id: 'student_spotlight', name: 'Student Spotlight', description: 'Feature dancers' },
  { id: 'holiday', name: 'Holiday/Seasonal', description: 'Holiday greetings' },
]

export default function AIGeneratorPage() {
  const [contentType, setContentType] = useState('')
  const [danceStyle, setDanceStyle] = useState('')
  const [ageGroup, setAgeGroup] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [platforms, setPlatforms] = useState<string[]>(['facebook', 'instagram'])
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    setIsGenerating(true)

    // Simulate AI generation (replace with actual API call)
    await new Promise(resolve => setTimeout(resolve, 1500))

    const sampleContent = generateSampleContent()
    setGeneratedContent(sampleContent)
    setIsGenerating(false)
  }

  const generateSampleContent = () => {
    const templates: Record<string, string> = {
      class_promo: `Ready to move? Our ${danceStyle || 'dance'} classes are calling your name! Perfect for ${ageGroup || 'all ages'}, these sessions blend technique with pure joy.

Limited spots available - DM us or click the link in bio to register!

#NicolesDanceCenterElite #${(danceStyle || 'Dance').replace(/\s/g, '')} #DanceClass #DanceStudio`,

      event_announcement: `MARK YOUR CALENDARS! Our ${danceStyle || ''} showcase is coming soon!

Watch our amazing dancers take the stage and show off what they've been working on. Friends and family welcome!

Stay tuned for date and ticket info!

#NDCEShowcase #DanceRecital #DancePerformance`,

      motivation: `Every great dancer was once a beginner. The magic happens when you show up, work hard, and never give up on your dreams.

See you in the studio!

#DanceMotivation #DanceLife #NeverStopDancing #NDCE`,

      behind_scenes: `A peek behind the curtain! Our ${ageGroup || ''} ${danceStyle || 'dance'} class putting in the work.

This is where the magic happens - dedication, practice, and lots of fun!

#BehindTheScenes #DanceRehearsals #StudioLife #NDCE`,

      student_spotlight: `SPOTLIGHT! Celebrating our incredible dancers who bring energy and passion to every class.

Proud doesn't even begin to describe how we feel watching these stars grow!

#StudentSpotlight #DancerLife #ProudMoments #NDCE`,

      holiday: `Wishing our NDCE family a wonderful day! We're grateful for every dancer, parent, and supporter who makes our studio special.

See you back in the studio soon!

#NDCEFamily #DanceCommunity #Grateful`,
    }

    return templates[contentType] || templates.motivation
  }

  const copyToClipboard = () => {
    if (generatedContent) {
      navigator.clipboard.writeText(generatedContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const togglePlatform = (platform: string) => {
    setPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    )
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">AI Content Generator</h1>
          <p className="mt-1 text-sm text-gray-600">
            Generate engaging social media content for your dance studio
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="rounded-lg bg-white p-6 shadow">
              <h2 className="mb-4 text-lg font-medium text-gray-900">Content Settings</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Content Type
                  </label>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                  >
                    <option value="">Select content type...</option>
                    {contentTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name} - {type.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Dance Style
                  </label>
                  <select
                    value={danceStyle}
                    onChange={(e) => setDanceStyle(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                  >
                    <option value="">Select style (optional)...</option>
                    {danceStyles.map((style) => (
                      <option key={style} value={style}>
                        {style}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Age Group
                  </label>
                  <select
                    value={ageGroup}
                    onChange={(e) => setAgeGroup(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                  >
                    <option value="">Select age group (optional)...</option>
                    {ageGroups.map((age) => (
                      <option key={age} value={age}>
                        {age}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Target Platforms
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {['facebook', 'instagram', 'tiktok'].map((platform) => (
                      <button
                        key={platform}
                        onClick={() => togglePlatform(platform)}
                        className={`rounded-full px-3 py-1 text-sm font-medium capitalize ${
                          platforms.includes(platform)
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {platform}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Additional Instructions (optional)
                  </label>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    rows={3}
                    placeholder="Add any specific details or tone preferences..."
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-purple-500"
                  />
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={!contentType || isGenerating}
                  className="w-full rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGenerating ? (
                    <span className="flex items-center justify-center">
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center">
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Content
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-blue-50 p-4">
              <h3 className="text-sm font-medium text-blue-800">Pro Tips</h3>
              <ul className="mt-2 space-y-1 text-sm text-blue-700">
                <li>Be specific about dance styles for better results</li>
                <li>Include seasonal themes for timely content</li>
                <li>Review and personalize generated content</li>
                <li>Add relevant photos or videos when posting</li>
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg bg-white p-6 shadow">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-gray-900">Generated Content</h2>
                {generatedContent && (
                  <div className="flex space-x-2">
                    <button
                      onClick={copyToClipboard}
                      className="flex items-center rounded-md bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-gray-200"
                    >
                      {copied ? (
                        <>
                          <Check className="mr-1 h-4 w-4 text-green-600" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="mr-1 h-4 w-4" />
                          Copy
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleGenerate}
                      className="flex items-center rounded-md bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-gray-200"
                    >
                      <RefreshCw className="mr-1 h-4 w-4" />
                      Regenerate
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-4">
                {generatedContent ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">
                      {generatedContent}
                    </pre>
                  </div>
                ) : (
                  <div className="flex h-48 items-center justify-center rounded-lg border-2 border-dashed border-gray-300">
                    <p className="text-sm text-gray-500">
                      Select content type and click Generate
                    </p>
                  </div>
                )}
              </div>

              {generatedContent && (
                <div className="mt-4 flex space-x-3">
                  <button className="flex flex-1 items-center justify-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
                    <Calendar className="mr-2 h-4 w-4" />
                    Add to Calendar
                  </button>
                  <button className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    Save as Draft
                  </button>
                </div>
              )}
            </div>

            {generatedContent && (
              <div className="rounded-lg bg-white p-6 shadow">
                <h3 className="text-sm font-medium text-gray-900">Preview</h3>
                <div className="mt-4 rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center space-x-3">
                    <div className="h-10 w-10 rounded-full bg-purple-600" />
                    <div>
                      <p className="font-medium text-gray-900">Nicole&apos;s Dance Center Elite</p>
                      <p className="text-xs text-gray-500">Just now</p>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-gray-800">
                    {generatedContent}
                  </p>
                  <div className="mt-4 flex items-center space-x-4 border-t border-gray-200 pt-3 text-sm text-gray-500">
                    <span>Like</span>
                    <span>Comment</span>
                    <span>Share</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
