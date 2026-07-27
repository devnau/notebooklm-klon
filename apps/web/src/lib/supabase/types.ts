// Generiert von scripts/gen-db-types.sh — nicht von Hand bearbeiten.
// Nach jeder Migration neu erzeugen: npm run db:types

export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      artifacts: {
        Row: {
          created_at: string;
          created_by: string | null;
          error: string | null;
          id: string;
          input_tokens: number | null;
          kind: string;
          notebook_id: string;
          output_tokens: number | null;
          payload: Json | null;
          source_ids: string[] | null;
          status: string;
          storage_path: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          error?: string | null;
          id?: string;
          input_tokens?: number | null;
          kind: string;
          notebook_id: string;
          output_tokens?: number | null;
          payload?: Json | null;
          source_ids?: string[] | null;
          status?: string;
          storage_path?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          error?: string | null;
          id?: string;
          input_tokens?: number | null;
          kind?: string;
          notebook_id?: string;
          output_tokens?: number | null;
          payload?: Json | null;
          source_ids?: string[] | null;
          status?: string;
          storage_path?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'artifacts_notebook_id_fkey';
            columns: ['notebook_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id'];
          },
        ];
      };
      chats: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          notebook_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notebook_id: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notebook_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chats_notebook_id_fkey';
            columns: ['notebook_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id'];
          },
        ];
      };
      chunks: {
        Row: {
          char_end: number | null;
          char_start: number | null;
          content: string;
          created_at: string;
          embedding: string | null;
          heading_path: string | null;
          id: number;
          idx: number;
          notebook_id: string;
          page: number | null;
          source_id: string;
          token_count: number | null;
          tsv: unknown;
        };
        Insert: {
          char_end?: number | null;
          char_start?: number | null;
          content: string;
          created_at?: string;
          embedding?: string | null;
          heading_path?: string | null;
          id?: never;
          idx: number;
          notebook_id: string;
          page?: number | null;
          source_id: string;
          token_count?: number | null;
          tsv?: unknown;
        };
        Update: {
          char_end?: number | null;
          char_start?: number | null;
          content?: string;
          created_at?: string;
          embedding?: string | null;
          heading_path?: string | null;
          id?: never;
          idx?: number;
          notebook_id?: string;
          page?: number | null;
          source_id?: string;
          token_count?: number | null;
          tsv?: unknown;
        };
        Relationships: [
          {
            foreignKeyName: 'chunks_notebook_id_fkey';
            columns: ['notebook_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chunks_source_id_fkey';
            columns: ['source_id'];
            isOneToOne: false;
            referencedRelation: 'sources';
            referencedColumns: ['id'];
          },
        ];
      };
      jobs: {
        Row: {
          attempts: number;
          created_at: string;
          error: string | null;
          id: number;
          kind: string;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          notebook_id: string;
          payload: Json;
          run_after: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          error?: string | null;
          id?: never;
          kind: string;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          notebook_id: string;
          payload?: Json;
          run_after?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          error?: string | null;
          id?: never;
          kind?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          notebook_id?: string;
          payload?: Json;
          run_after?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'jobs_notebook_id_fkey';
            columns: ['notebook_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id'];
          },
        ];
      };
      llm_usage: {
        Row: {
          cache_read_tokens: number;
          cache_write_tokens: number;
          created_at: string;
          id: number;
          input_tokens: number;
          kind: string;
          model: string;
          notebook_id: string | null;
          output_tokens: number;
          user_id: string | null;
        };
        Insert: {
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          created_at?: string;
          id?: never;
          input_tokens?: number;
          kind: string;
          model: string;
          notebook_id?: string | null;
          output_tokens?: number;
          user_id?: string | null;
        };
        Update: {
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          created_at?: string;
          id?: never;
          input_tokens?: number;
          kind?: string;
          model?: string;
          notebook_id?: string | null;
          output_tokens?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'llm_usage_notebook_id_fkey';
            columns: ['notebook_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          cache_read_tokens: number | null;
          chat_id: string;
          citations: Json;
          content: string;
          created_at: string;
          created_by: string | null;
          id: number;
          input_tokens: number | null;
          notebook_id: string;
          output_tokens: number | null;
          role: string;
          source_ids: string[] | null;
        };
        Insert: {
          cache_read_tokens?: number | null;
          chat_id: string;
          citations?: Json;
          content: string;
          created_at?: string;
          created_by?: string | null;
          id?: never;
          input_tokens?: number | null;
          notebook_id: string;
          output_tokens?: number | null;
          role: string;
          source_ids?: string[] | null;
        };
        Update: {
          cache_read_tokens?: number | null;
          chat_id?: string;
          citations?: Json;
          content?: string;
          created_at?: string;
          created_by?: string | null;
          id?: never;
          input_tokens?: number | null;
          notebook_id?: string;
          output_tokens?: number | null;
          role?: string;
          source_ids?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_chat_id_fkey';
            columns: ['chat_id'];
            isOneToOne: false;
            referencedRelation: 'chats';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_notebook_id_fkey';
            columns: ['notebook_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id'];
          },
        ];
      };
      notebook_members: {
        Row: {
          created_at: string;
          invited_by: string | null;
          notebook_id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          invited_by?: string | null;
          notebook_id: string;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          invited_by?: string | null;
          notebook_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notebook_members_notebook_id_fkey';
            columns: ['notebook_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id'];
          },
        ];
      };
      notebooks: {
        Row: {
          created_at: string;
          emoji: string;
          id: string;
          language: string;
          owner_id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          emoji?: string;
          id?: string;
          language?: string;
          owner_id: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          emoji?: string;
          id?: string;
          language?: string;
          owner_id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      notes: {
        Row: {
          citations: Json;
          content: string;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: string;
          notebook_id: string;
          source_message_id: number | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          citations?: Json;
          content?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          notebook_id: string;
          source_message_id?: number | null;
          title?: string;
          updated_at?: string;
        };
        Update: {
          citations?: Json;
          content?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          notebook_id?: string;
          source_message_id?: number | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notes_notebook_id_fkey';
            columns: ['notebook_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notes_source_message_id_fkey';
            columns: ['source_message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          email: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rate_limit_events: {
        Row: {
          action: string;
          created_at: string;
          id: number;
          user_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          id?: never;
          user_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: never;
          user_id?: string;
        };
        Relationships: [];
      };
      schema_migrations: {
        Row: {
          applied_at: string;
          checksum: string;
          version: string;
        };
        Insert: {
          applied_at?: string;
          checksum: string;
          version: string;
        };
        Update: {
          applied_at?: string;
          checksum?: string;
          version?: string;
        };
        Relationships: [];
      };
      sources: {
        Row: {
          byte_size: number | null;
          char_count: number | null;
          created_at: string;
          created_by: string | null;
          error: string | null;
          id: string;
          key_topics: string[] | null;
          kind: string;
          mime_type: string | null;
          notebook_id: string;
          page_count: number | null;
          source_url: string | null;
          status: string;
          storage_path: string | null;
          summary: string | null;
          text_path: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          byte_size?: number | null;
          char_count?: number | null;
          created_at?: string;
          created_by?: string | null;
          error?: string | null;
          id?: string;
          key_topics?: string[] | null;
          kind: string;
          mime_type?: string | null;
          notebook_id: string;
          page_count?: number | null;
          source_url?: string | null;
          status?: string;
          storage_path?: string | null;
          summary?: string | null;
          text_path?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          byte_size?: number | null;
          char_count?: number | null;
          created_at?: string;
          created_by?: string | null;
          error?: string | null;
          id?: string;
          key_topics?: string[] | null;
          kind?: string;
          mime_type?: string | null;
          notebook_id?: string;
          page_count?: number | null;
          source_url?: string | null;
          status?: string;
          storage_path?: string | null;
          summary?: string | null;
          text_path?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sources_notebook_id_fkey';
            columns: ['notebook_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_job: {
        Args: { worker_id: string };
        Returns: {
          attempts: number;
          job_id: number;
          kind: string;
          notebook_id: string;
          payload: Json;
        }[];
      };
      consume_rate_limit: {
        Args: { p_action: string; p_limit: number; p_window_seconds?: number };
        Returns: number;
      };
      generate_url_token: { Args: { byte_length?: number }; Returns: string };
      is_notebook_member: {
        Args: { min_role?: string; nb: string };
        Returns: boolean;
      };
      match_chunks: {
        Args: {
          p_candidates?: number;
          p_embedding: string;
          p_limit?: number;
          p_notebook: string;
          p_query: string;
          p_source_ids?: string[];
        };
        Returns: {
          char_end: number;
          char_start: number;
          chunk_id: number;
          content: string;
          fulltext_rank: number;
          heading_path: string;
          idx: number;
          page: number;
          score: number;
          source_id: string;
          vector_rank: number;
        }[];
      };
      prune_rate_limit_events: { Args: never; Returns: number };
      request_artifact: {
        Args: { p_kind: string; p_notebook: string };
        Returns: string;
      };
      request_audio_overview: { Args: { p_notebook: string }; Returns: string };
      requeue_stale_jobs: { Args: { lease_seconds?: number }; Returns: number };
      retry_source: { Args: { p_source_id: string }; Returns: undefined };
      storage_notebook_id: { Args: { object_name: string }; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
