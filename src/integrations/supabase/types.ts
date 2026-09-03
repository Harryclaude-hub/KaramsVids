export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      affiliate_programs: {
        Row: {
          active: boolean;
          created_at: string;
          currency: string;
          id: string;
          link: string;
          name: string;
          notes: string | null;
          payout_amount: number;
          payout_type: string;
          updated_at: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          currency?: string;
          id?: string;
          link: string;
          name: string;
          notes?: string | null;
          payout_amount?: number;
          payout_type?: string;
          updated_at?: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          currency?: string;
          id?: string;
          link?: string;
          name?: string;
          notes?: string | null;
          payout_amount?: number;
          payout_type?: string;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "affiliate_programs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      analytics_snapshots: {
        Row: {
          brand_id: string;
          created_at: string;
          id: string;
          metrics: Json;
          platform: string;
          snapshot_at: string;
          social_account_id: string;
          user_id: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          id?: string;
          metrics?: Json;
          platform: string;
          snapshot_at?: string;
          social_account_id: string;
          user_id: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          id?: string;
          metrics?: Json;
          platform?: string;
          snapshot_at?: string;
          social_account_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_snapshots_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analytics_snapshots_social_account_id_fkey";
            columns: ["social_account_id"];
            isOneToOne: false;
            referencedRelation: "social_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_events: {
        Row: {
          brand_id: string;
          created_at: string;
          error: string | null;
          id: string;
          message_sent: string | null;
          platform: string;
          rule_id: string | null;
          status: string;
          target_handle: string | null;
          trigger_type: string;
          user_id: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          message_sent?: string | null;
          platform: string;
          rule_id?: string | null;
          status?: string;
          target_handle?: string | null;
          trigger_type: string;
          user_id: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          message_sent?: string | null;
          platform?: string;
          rule_id?: string | null;
          status?: string;
          target_handle?: string | null;
          trigger_type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_events_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_events_rule_id_fkey";
            columns: ["rule_id"];
            isOneToOne: false;
            referencedRelation: "automation_rules";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_rules: {
        Row: {
          active: boolean;
          brand_id: string;
          created_at: string;
          delay_minutes: number;
          id: string;
          keyword: string | null;
          message_template: string;
          platform: string;
          trigger_type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          brand_id: string;
          created_at?: string;
          delay_minutes?: number;
          id?: string;
          keyword?: string | null;
          message_template: string;
          platform: string;
          trigger_type?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          brand_id?: string;
          created_at?: string;
          delay_minutes?: number;
          id?: string;
          keyword?: string | null;
          message_template?: string;
          platform?: string;
          trigger_type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_rules_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_credentials: {
        Row: {
          brand_id: string;
          created_at: string;
          email: string | null;
          id: string;
          login_url: string | null;
          notes: string | null;
          password_encrypted: string | null;
          platform: string;
          setup_status: string;
          setup_updated_at: string | null;
          updated_at: string;
          user_id: string;
          username: string | null;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          login_url?: string | null;
          notes?: string | null;
          password_encrypted?: string | null;
          platform: string;
          setup_status?: string;
          setup_updated_at?: string | null;
          updated_at?: string;
          user_id: string;
          username?: string | null;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          login_url?: string | null;
          notes?: string | null;
          password_encrypted?: string | null;
          platform?: string;
          setup_status?: string;
          setup_updated_at?: string | null;
          updated_at?: string;
          user_id?: string;
          username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "brand_credentials_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      brands: {
        Row: {
          avatar_path: string | null;
          bio: string | null;
          color: string;
          created_at: string;
          handle: string | null;
          id: string;
          name: string;
          name_font: string;
          updated_at: string;
          user_id: string;
          watermark_enabled: boolean;
          watermark_path: string | null;
          watermark_position: string;
          workspace_id: string | null;
        };
        Insert: {
          avatar_path?: string | null;
          bio?: string | null;
          color?: string;
          created_at?: string;
          handle?: string | null;
          id?: string;
          name: string;
          name_font?: string;
          updated_at?: string;
          user_id: string;
          watermark_enabled?: boolean;
          watermark_path?: string | null;
          watermark_position?: string;
          workspace_id?: string | null;
        };
        Update: {
          avatar_path?: string | null;
          bio?: string | null;
          color?: string;
          created_at?: string;
          handle?: string | null;
          id?: string;
          name?: string;
          name_font?: string;
          updated_at?: string;
          user_id?: string;
          watermark_enabled?: boolean;
          watermark_path?: string | null;
          watermark_position?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "brands_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      earnings: {
        Row: {
          affiliate_program_id: string | null;
          amount: number;
          brand_id: string | null;
          created_at: string;
          currency: string;
          id: string;
          note: string | null;
          period_end: string | null;
          period_start: string | null;
          platform: string | null;
          source: string;
          status: string;
          updated_at: string;
          user_id: string;
          views: number;
          workspace_id: string;
        };
        Insert: {
          affiliate_program_id?: string | null;
          amount?: number;
          brand_id?: string | null;
          created_at?: string;
          currency?: string;
          id?: string;
          note?: string | null;
          period_end?: string | null;
          period_start?: string | null;
          platform?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
          views?: number;
          workspace_id: string;
        };
        Update: {
          affiliate_program_id?: string | null;
          amount?: number;
          brand_id?: string | null;
          created_at?: string;
          currency?: string;
          id?: string;
          note?: string | null;
          period_end?: string | null;
          period_start?: string | null;
          platform?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
          views?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "earnings_affiliate_program_id_fkey";
            columns: ["affiliate_program_id"];
            isOneToOne: false;
            referencedRelation: "affiliate_programs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "earnings_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "earnings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      edit_jobs: {
        Row: {
          analysis: Json | null;
          brand_id: string | null;
          chat_messages: Json;
          created_at: string;
          desired_clip_count: number | null;
          error: string | null;
          id: string;
          mode: Database["public"]["Enums"]["edit_mode"];
          options: Json;
          progress: number;
          raw_video_id: string;
          status: Database["public"]["Enums"]["job_status"];
          style_reference: Json | null;
          timeline_state: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          analysis?: Json | null;
          brand_id?: string | null;
          chat_messages?: Json;
          created_at?: string;
          desired_clip_count?: number | null;
          error?: string | null;
          id?: string;
          mode: Database["public"]["Enums"]["edit_mode"];
          options?: Json;
          progress?: number;
          raw_video_id: string;
          status?: Database["public"]["Enums"]["job_status"];
          style_reference?: Json | null;
          timeline_state?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          analysis?: Json | null;
          brand_id?: string | null;
          chat_messages?: Json;
          created_at?: string;
          desired_clip_count?: number | null;
          error?: string | null;
          id?: string;
          mode?: Database["public"]["Enums"]["edit_mode"];
          options?: Json;
          progress?: number;
          raw_video_id?: string;
          status?: Database["public"]["Enums"]["job_status"];
          style_reference?: Json | null;
          timeline_state?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "edit_jobs_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "edit_jobs_raw_video_id_fkey";
            columns: ["raw_video_id"];
            isOneToOne: false;
            referencedRelation: "raw_videos";
            referencedColumns: ["id"];
          },
        ];
      };
      folders: {
        Row: {
          brand_id: string;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "folders_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      generated_clips: {
        Row: {
          affiliate_program_id: string | null;
          aspect: string;
          audio_tracks: Json;
          brand_id: string | null;
          caption_srt: string | null;
          created_at: string;
          duration_s: number | null;
          hashtags: string | null;
          id: string;
          job_id: string;
          meta: Json;
          overlays: Json;
          platform: string | null;
          post_caption: string | null;
          post_type: string;
          publish_error: string | null;
          published_at: string | null;
          published_url: string | null;
          queue_position: number;
          scheduled_for: string | null;
          status: string;
          storage_path: string;
          title: string | null;
          transitions: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          affiliate_program_id?: string | null;
          aspect?: string;
          audio_tracks?: Json;
          brand_id?: string | null;
          caption_srt?: string | null;
          created_at?: string;
          duration_s?: number | null;
          hashtags?: string | null;
          id?: string;
          job_id: string;
          meta?: Json;
          overlays?: Json;
          platform?: string | null;
          post_caption?: string | null;
          post_type?: string;
          publish_error?: string | null;
          published_at?: string | null;
          published_url?: string | null;
          queue_position?: number;
          scheduled_for?: string | null;
          status?: string;
          storage_path: string;
          title?: string | null;
          transitions?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          affiliate_program_id?: string | null;
          aspect?: string;
          audio_tracks?: Json;
          brand_id?: string | null;
          caption_srt?: string | null;
          created_at?: string;
          duration_s?: number | null;
          hashtags?: string | null;
          id?: string;
          job_id?: string;
          meta?: Json;
          overlays?: Json;
          platform?: string | null;
          post_caption?: string | null;
          post_type?: string;
          publish_error?: string | null;
          published_at?: string | null;
          published_url?: string | null;
          queue_position?: number;
          scheduled_for?: string | null;
          status?: string;
          storage_path?: string;
          title?: string | null;
          transitions?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "generated_clips_affiliate_program_id_fkey";
            columns: ["affiliate_program_id"];
            isOneToOne: false;
            referencedRelation: "affiliate_programs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_clips_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_clips_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "edit_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          email: string | null;
          id: string;
          role: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id: string;
          role?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
          role?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      publish_schedules: {
        Row: {
          active: boolean;
          brand_id: string;
          brand_ids: string[];
          cadence: string;
          created_at: string;
          id: string;
          interval_minutes: number | null;
          last_run_at: string | null;
          next_run_at: string;
          platform: string;
          platforms: string[];
          post_types: string[];
          shuffle: boolean;
          time_of_day: string;
          updated_at: string;
          user_id: string;
          videos_per_slot: number;
          weekdays: number[];
          workspace_id: string | null;
        };
        Insert: {
          active?: boolean;
          brand_id: string;
          brand_ids?: string[];
          cadence?: string;
          created_at?: string;
          id?: string;
          interval_minutes?: number | null;
          last_run_at?: string | null;
          next_run_at?: string;
          platform: string;
          platforms?: string[];
          post_types?: string[];
          shuffle?: boolean;
          time_of_day?: string;
          updated_at?: string;
          user_id: string;
          videos_per_slot?: number;
          weekdays?: number[];
          workspace_id?: string | null;
        };
        Update: {
          active?: boolean;
          brand_id?: string;
          brand_ids?: string[];
          cadence?: string;
          created_at?: string;
          id?: string;
          interval_minutes?: number | null;
          last_run_at?: string | null;
          next_run_at?: string;
          platform?: string;
          platforms?: string[];
          post_types?: string[];
          shuffle?: boolean;
          time_of_day?: string;
          updated_at?: string;
          user_id?: string;
          videos_per_slot?: number;
          weekdays?: number[];
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "publish_schedules_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "publish_schedules_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      raw_videos: {
        Row: {
          brand_id: string | null;
          created_at: string;
          duration_s: number | null;
          folder_id: string | null;
          id: string;
          platform: string | null;
          size_bytes: number | null;
          source_url: string | null;
          status: string;
          storage_path: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          brand_id?: string | null;
          created_at?: string;
          duration_s?: number | null;
          folder_id?: string | null;
          id?: string;
          platform?: string | null;
          size_bytes?: number | null;
          source_url?: string | null;
          status?: string;
          storage_path?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          brand_id?: string | null;
          created_at?: string;
          duration_s?: number | null;
          folder_id?: string | null;
          id?: string;
          platform?: string | null;
          size_bytes?: number | null;
          source_url?: string | null;
          status?: string;
          storage_path?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "raw_videos_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "raw_videos_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      render_jobs: {
        Row: {
          aspect: string;
          attempts: number;
          audio_path: string | null;
          brand_id: string | null;
          captions_srt: string | null;
          clip_id: string | null;
          clip_index: number;
          cost_usd: number;
          created_at: string;
          end_s: number;
          error: string | null;
          finished_at: string | null;
          id: string;
          job_id: string;
          music_url: string | null;
          music_volume: number;
          output_url: string | null;
          progress: number;
          provider: string;
          provider_render_id: string | null;
          render_seconds: number | null;
          source_url: string | null;
          start_s: number;
          status: string;
          storage_path: string | null;
          submitted_at: string | null;
          template_config: Json;
          template_id: string;
          thumbnail_path: string | null;
          title: string | null;
          updated_at: string;
          user_id: string;
          webhook_received_at: string | null;
          workspace_id: string | null;
        };
        Insert: {
          aspect?: string;
          attempts?: number;
          audio_path?: string | null;
          brand_id?: string | null;
          captions_srt?: string | null;
          clip_id?: string | null;
          clip_index?: number;
          cost_usd?: number;
          created_at?: string;
          end_s?: number;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          job_id: string;
          music_url?: string | null;
          music_volume?: number;
          output_url?: string | null;
          progress?: number;
          provider?: string;
          provider_render_id?: string | null;
          render_seconds?: number | null;
          source_url?: string | null;
          start_s?: number;
          status?: string;
          storage_path?: string | null;
          submitted_at?: string | null;
          template_config?: Json;
          template_id?: string;
          thumbnail_path?: string | null;
          title?: string | null;
          updated_at?: string;
          user_id: string;
          webhook_received_at?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          aspect?: string;
          attempts?: number;
          audio_path?: string | null;
          brand_id?: string | null;
          captions_srt?: string | null;
          clip_id?: string | null;
          clip_index?: number;
          cost_usd?: number;
          created_at?: string;
          end_s?: number;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          job_id?: string;
          music_url?: string | null;
          music_volume?: number;
          output_url?: string | null;
          progress?: number;
          provider?: string;
          provider_render_id?: string | null;
          render_seconds?: number | null;
          source_url?: string | null;
          start_s?: number;
          status?: string;
          storage_path?: string | null;
          submitted_at?: string | null;
          template_config?: Json;
          template_id?: string;
          thumbnail_path?: string | null;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
          webhook_received_at?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [];
      };
      render_template_presets: {
        Row: {
          base_template_id: string;
          config: Json;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
          user_id: string;
          workspace_id: string | null;
        };
        Insert: {
          base_template_id?: string;
          config?: Json;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
          user_id: string;
          workspace_id?: string | null;
        };
        Update: {
          base_template_id?: string;
          config?: Json;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
          user_id?: string;
          workspace_id?: string | null;
        };
        Relationships: [];
      };
      social_accounts: {
        Row: {
          access_token_encrypted: string | null;
          brand_id: string | null;
          created_at: string;
          expires_at: string | null;
          handle: string | null;
          id: string;
          last_sync_at: string | null;
          meta: Json;
          platform: Database["public"]["Enums"]["social_platform"];
          refresh_token_encrypted: string | null;
          status: string;
          sync_error: string | null;
          user_id: string;
        };
        Insert: {
          access_token_encrypted?: string | null;
          brand_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          handle?: string | null;
          id?: string;
          last_sync_at?: string | null;
          meta?: Json;
          platform: Database["public"]["Enums"]["social_platform"];
          refresh_token_encrypted?: string | null;
          status?: string;
          sync_error?: string | null;
          user_id: string;
        };
        Update: {
          access_token_encrypted?: string | null;
          brand_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          handle?: string | null;
          id?: string;
          last_sync_at?: string | null;
          meta?: Json;
          platform?: Database["public"]["Enums"]["social_platform"];
          refresh_token_encrypted?: string | null;
          status?: string;
          sync_error?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "social_accounts_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          avatar_path: string | null;
          color: string;
          created_at: string;
          id: string;
          name: string;
          notes: string | null;
          payout_details: Json;
          payout_provider: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          avatar_path?: string | null;
          color?: string;
          created_at?: string;
          id?: string;
          name: string;
          notes?: string | null;
          payout_details?: Json;
          payout_provider?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          avatar_path?: string | null;
          color?: string;
          created_at?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          payout_details?: Json;
          payout_provider?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_admin: { Args: { _uid: string }; Returns: boolean };
    };
    Enums: {
      edit_mode: "auto_cut" | "ugc_shorts" | "long_to_many" | "manual";
      job_status: "pending" | "analyzing" | "ready" | "rendering" | "done" | "failed";
      social_platform: "tiktok" | "youtube" | "instagram" | "facebook" | "x";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      edit_mode: ["auto_cut", "ugc_shorts", "long_to_many", "manual"],
      job_status: ["pending", "analyzing", "ready", "rendering", "done", "failed"],
      social_platform: ["tiktok", "youtube", "instagram", "facebook", "x"],
    },
  },
} as const;
