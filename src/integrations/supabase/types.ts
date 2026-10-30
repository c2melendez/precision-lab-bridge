export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      bridge_calls: {
        Row: {
          created_at: string
          endpoint: string
          http_status: number
          id: string
          key_prefix: string | null
          params: Json
          result: Json
        }
        Insert: {
          created_at?: string
          endpoint: string
          http_status: number
          id?: string
          key_prefix?: string | null
          params?: Json
          result?: Json
        }
        Update: {
          created_at?: string
          endpoint?: string
          http_status?: number
          id?: string
          key_prefix?: string | null
          params?: Json
          result?: Json
        }
        Relationships: []
      }
      bridge_idempotency: {
        Row: {
          attempt_count: number
          branch: string
          correlation_id: string
          created_at: string
          dispatch_intents: Json
          error_code: string | null
          finished_at: string | null
          gh_runs: Json
          http_status: number | null
          id: string
          idempotency_key: string
          job_ids: Json
          key_id: string
          lease_expires_at: string | null
          lease_token: string | null
          outcome_state: string | null
          replay_count: number
          repo: string
          request_fingerprint: string
          request_payload: Json
          requested_sha: string | null
          response: Json | null
          run_id: string | null
          started_at: string | null
          state: string
          updated_at: string
          validation_id: string
          workflow_result: Json | null
        }
        Insert: {
          attempt_count?: number
          branch: string
          correlation_id: string
          created_at?: string
          dispatch_intents?: Json
          error_code?: string | null
          finished_at?: string | null
          gh_runs?: Json
          http_status?: number | null
          id?: string
          idempotency_key: string
          job_ids?: Json
          key_id: string
          lease_expires_at?: string | null
          lease_token?: string | null
          outcome_state?: string | null
          replay_count?: number
          repo: string
          request_fingerprint: string
          request_payload: Json
          requested_sha?: string | null
          response?: Json | null
          run_id?: string | null
          started_at?: string | null
          state?: string
          updated_at?: string
          validation_id: string
          workflow_result?: Json | null
        }
        Update: {
          attempt_count?: number
          branch?: string
          correlation_id?: string
          created_at?: string
          dispatch_intents?: Json
          error_code?: string | null
          finished_at?: string | null
          gh_runs?: Json
          http_status?: number | null
          id?: string
          idempotency_key?: string
          job_ids?: Json
          key_id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          outcome_state?: string | null
          replay_count?: number
          repo?: string
          request_fingerprint?: string
          request_payload?: Json
          requested_sha?: string | null
          response?: Json | null
          run_id?: string | null
          started_at?: string | null
          state?: string
          updated_at?: string
          validation_id?: string
          workflow_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "bridge_idempotency_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "bridge_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bridge_idempotency_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "bridge_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      bridge_keys: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: []
      }
      bridge_runs: {
        Row: {
          dispatched_at: string
          dry_run: boolean
          gate: string
          gh_runs: Json
          id: string
          key_id: string
          target_repo: string
        }
        Insert: {
          dispatched_at?: string
          dry_run: boolean
          gate: string
          gh_runs?: Json
          id?: string
          key_id: string
          target_repo: string
        }
        Update: {
          dispatched_at?: string
          dry_run?: boolean
          gate?: string
          gh_runs?: Json
          id?: string
          key_id?: string
          target_repo?: string
        }
        Relationships: [
          {
            foreignKeyName: "bridge_runs_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "bridge_keys"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bridge_begin_dispatch: {
        Args: { p_id: string; p_repo: string; p_token: string }
        Returns: boolean
      }
      bridge_claim: {
        Args: {
          p_branch: string
          p_correlation_id: string
          p_fingerprint: string
          p_key: string
          p_key_id: string
          p_payload: Json
          p_repo: string
          p_sha: string
          p_validation_id: string
        }
        Returns: Json
      }
      bridge_finish: {
        Args: {
          p_error?: string
          p_id: string
          p_response: Json
          p_state: string
          p_status: number
          p_token: string
        }
        Returns: boolean
      }
      bridge_prepare: {
        Args: { p_id: string; p_token: string }
        Returns: string
      }
      bridge_record_dispatch: {
        Args: { p_id: string; p_run: Json; p_token: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const