export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      content_calendar: {
        Row: {
          id: string
          title: string
          content: string | null
          content_type: string
          scheduled_date: string
          scheduled_time: string | null
          timezone: string
          platforms: string[]
          media_urls: Json[]
          ai_generated: boolean
          ai_prompt: string | null
          ai_model: string | null
          status: 'draft' | 'scheduled' | 'posted' | 'failed' | 'cancelled'
          dance_style: string | null
          age_group: string | null
          event_reference: string | null
          engagement_metrics: Json
          created_at: string
          updated_at: string
          created_by: string | null
          published_at: string | null
        }
        Insert: {
          id?: string
          title: string
          content?: string | null
          content_type?: string
          scheduled_date: string
          scheduled_time?: string | null
          timezone?: string
          platforms?: string[]
          media_urls?: Json[]
          ai_generated?: boolean
          ai_prompt?: string | null
          ai_model?: string | null
          status?: 'draft' | 'scheduled' | 'posted' | 'failed' | 'cancelled'
          dance_style?: string | null
          age_group?: string | null
          event_reference?: string | null
          engagement_metrics?: Json
          created_at?: string
          updated_at?: string
          created_by?: string | null
          published_at?: string | null
        }
        Update: {
          id?: string
          title?: string
          content?: string | null
          content_type?: string
          scheduled_date?: string
          scheduled_time?: string | null
          timezone?: string
          platforms?: string[]
          media_urls?: Json[]
          ai_generated?: boolean
          ai_prompt?: string | null
          ai_model?: string | null
          status?: 'draft' | 'scheduled' | 'posted' | 'failed' | 'cancelled'
          dance_style?: string | null
          age_group?: string | null
          event_reference?: string | null
          engagement_metrics?: Json
          created_at?: string
          updated_at?: string
          created_by?: string | null
          published_at?: string | null
        }
      }
      social_posts: {
        Row: {
          id: string
          calendar_item_id: string | null
          platform: string
          platform_post_id: string | null
          platform_url: string | null
          content: string | null
          media_urls: Json[]
          status: 'pending' | 'posted' | 'failed' | 'deleted'
          error_message: string | null
          likes: number
          comments: number
          shares: number
          reach: number
          impressions: number
          engagement_rate: number | null
          posted_at: string | null
          created_at: string
          updated_at: string
          last_engagement_sync: string | null
        }
        Insert: {
          id?: string
          calendar_item_id?: string | null
          platform: string
          platform_post_id?: string | null
          platform_url?: string | null
          content?: string | null
          media_urls?: Json[]
          status?: 'pending' | 'posted' | 'failed' | 'deleted'
          error_message?: string | null
          likes?: number
          comments?: number
          shares?: number
          reach?: number
          impressions?: number
          engagement_rate?: number | null
          posted_at?: string | null
          created_at?: string
          updated_at?: string
          last_engagement_sync?: string | null
        }
        Update: {
          id?: string
          calendar_item_id?: string | null
          platform?: string
          platform_post_id?: string | null
          platform_url?: string | null
          content?: string | null
          media_urls?: Json[]
          status?: 'pending' | 'posted' | 'failed' | 'deleted'
          error_message?: string | null
          likes?: number
          comments?: number
          shares?: number
          reach?: number
          impressions?: number
          engagement_rate?: number | null
          posted_at?: string | null
          created_at?: string
          updated_at?: string
          last_engagement_sync?: string | null
        }
      }
      content_templates: {
        Row: {
          id: string
          name: string
          description: string | null
          template_content: string
          category: string | null
          platforms: string[]
          suggested_media_type: string | null
          media_guidelines: string | null
          times_used: number
          last_used_at: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          template_content: string
          category?: string | null
          platforms?: string[]
          suggested_media_type?: string | null
          media_guidelines?: string | null
          times_used?: number
          last_used_at?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          template_content?: string
          category?: string | null
          platforms?: string[]
          suggested_media_type?: string | null
          media_guidelines?: string | null
          times_used?: number
          last_used_at?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      dance_events: {
        Row: {
          id: string
          title: string
          description: string | null
          event_date: string
          start_time: string | null
          end_time: string | null
          is_recurring: boolean
          recurrence_pattern: Json | null
          event_type: string
          location: string | null
          dance_style: string | null
          age_group: string | null
          instructor: string | null
          price: number | null
          registration_url: string | null
          image_url: string | null
          is_active: boolean
          is_featured: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          description?: string | null
          event_date: string
          start_time?: string | null
          end_time?: string | null
          is_recurring?: boolean
          recurrence_pattern?: Json | null
          event_type: string
          location?: string | null
          dance_style?: string | null
          age_group?: string | null
          instructor?: string | null
          price?: number | null
          registration_url?: string | null
          image_url?: string | null
          is_active?: boolean
          is_featured?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          description?: string | null
          event_date?: string
          start_time?: string | null
          end_time?: string | null
          is_recurring?: boolean
          recurrence_pattern?: Json | null
          event_type?: string
          location?: string | null
          dance_style?: string | null
          age_group?: string | null
          instructor?: string | null
          price?: number | null
          registration_url?: string | null
          image_url?: string | null
          is_active?: boolean
          is_featured?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      ai_content_suggestions: {
        Row: {
          id: string
          suggested_title: string | null
          suggested_content: string
          suggested_date: string | null
          suggested_time: string | null
          ai_model: string | null
          generation_prompt: string | null
          confidence_score: number | null
          content_type: string | null
          dance_style: string | null
          target_audience: string | null
          status: 'pending' | 'accepted' | 'rejected' | 'modified'
          accepted_at: string | null
          rejected_at: string | null
          rejection_reason: string | null
          calendar_item_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          suggested_title?: string | null
          suggested_content: string
          suggested_date?: string | null
          suggested_time?: string | null
          ai_model?: string | null
          generation_prompt?: string | null
          confidence_score?: number | null
          content_type?: string | null
          dance_style?: string | null
          target_audience?: string | null
          status?: 'pending' | 'accepted' | 'rejected' | 'modified'
          accepted_at?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          calendar_item_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          suggested_title?: string | null
          suggested_content?: string
          suggested_date?: string | null
          suggested_time?: string | null
          ai_model?: string | null
          generation_prompt?: string | null
          confidence_score?: number | null
          content_type?: string | null
          dance_style?: string | null
          target_audience?: string | null
          status?: 'pending' | 'accepted' | 'rejected' | 'modified'
          accepted_at?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          calendar_item_id?: string | null
          created_at?: string
        }
      }
      platform_credentials: {
        Row: {
          id: string
          platform: string
          credentials_encrypted: string | null
          access_token_expires_at: string | null
          refresh_token_expires_at: string | null
          platform_user_id: string | null
          platform_page_id: string | null
          platform_username: string | null
          is_connected: boolean
          last_verified_at: string | null
          connection_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          platform: string
          credentials_encrypted?: string | null
          access_token_expires_at?: string | null
          refresh_token_expires_at?: string | null
          platform_user_id?: string | null
          platform_page_id?: string | null
          platform_username?: string | null
          is_connected?: boolean
          last_verified_at?: string | null
          connection_error?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          platform?: string
          credentials_encrypted?: string | null
          access_token_expires_at?: string | null
          refresh_token_expires_at?: string | null
          platform_user_id?: string | null
          platform_page_id?: string | null
          platform_username?: string | null
          is_connected?: boolean
          last_verified_at?: string | null
          connection_error?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}
