export type NotificationItem = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  kind: string;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
  action: string | null;
  subject_type: string | null;
  subject_id: string | null;
  metadata_json: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};
