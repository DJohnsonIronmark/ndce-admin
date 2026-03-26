'use client'

import { CheckCircle, Circle, Loader2, XCircle } from 'lucide-react'

export type ProgressStep = {
  id: string
  label: string
  status: 'pending' | 'active' | 'complete' | 'error'
  detail?: string
}

interface ProgressTrackerProps {
  steps: ProgressStep[]
  title?: string
}

export default function ProgressTracker({ steps, title }: ProgressTrackerProps) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      {title && (
        <h4 className="font-medium text-gray-900 mb-3">{title}</h4>
      )}
      <div className="space-y-2">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-3">
            {/* Status Icon */}
            <div className="flex-shrink-0">
              {step.status === 'pending' && (
                <Circle className="h-5 w-5 text-gray-300" />
              )}
              {step.status === 'active' && (
                <Loader2 className="h-5 w-5 text-purple-600 animate-spin" />
              )}
              {step.status === 'complete' && (
                <CheckCircle className="h-5 w-5 text-green-600" />
              )}
              {step.status === 'error' && (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
            </div>

            {/* Label and Detail */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${
                step.status === 'active' ? 'text-purple-700' :
                step.status === 'complete' ? 'text-green-700' :
                step.status === 'error' ? 'text-red-700' :
                'text-gray-500'
              }`}>
                {step.label}
              </p>
              {step.detail && (
                <p className="text-xs text-gray-500 truncate">{step.detail}</p>
              )}
            </div>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div className="absolute left-[1.35rem] top-7 h-4 w-px bg-gray-200" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Predefined step configurations
export const UPDATE_STEPS = {
  FINDING: { id: 'finding', label: 'Finding matches', status: 'pending' as const },
  APPLYING: { id: 'applying', label: 'Applying changes', status: 'pending' as const },
  STAGING: { id: 'staging', label: 'Staging for review', status: 'pending' as const },
  AWAITING: { id: 'awaiting', label: 'Awaiting approval', status: 'pending' as const },
  COMMITTING: { id: 'committing', label: 'Committing changes', status: 'pending' as const },
  PUSHING: { id: 'pushing', label: 'Pushing to GitHub', status: 'pending' as const },
  DEPLOYING: { id: 'deploying', label: 'Deploying to Vercel', status: 'pending' as const },
  COMPLETE: { id: 'complete', label: 'Update complete', status: 'pending' as const },
}
