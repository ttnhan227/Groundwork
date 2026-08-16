import type { Job } from "./job";

export type Citation = {
  document_id: string;
  document_name: string;
  page_number: number;
  snippet: string;
};

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  created_at?: string;
};

export type Conversation = {
  id: string;
  title: string;
  document_ids: string[];
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
};

export type ConversationCommand = {
  message_id: string;
  planner_run_id: string;
  workflow: import("./job").PersistedWorkflow;
  job: Job | null;
};
