import type { Citation } from "./chat";

export type NoteType = "user" | "saved_answer" | "excerpt" | "studio_output";

export interface Note {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  content: string;
  note_type: NoteType;
  source_id?: string | null;
  source_title?: string | null;
  page_number?: number | null;
  message_id?: string | null;
  citations?: Citation[];
  created_at: string;
  updated_at: string;
}

export interface NoteCreateInput {
  title?: string;
  content?: string;
  note_type?: NoteType;
  source_id?: string | null;
  source_title?: string | null;
  page_number?: number | null;
  message_id?: string | null;
  citations?: Citation[];
}

export interface NoteUpdateInput {
  title?: string;
  content?: string;
  note_type?: NoteType;
  citations?: Citation[];
}
