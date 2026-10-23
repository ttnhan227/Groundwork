import type { StorageCategory } from "../../types/api";

export const categoryColors: Record<StorageCategory, string> = {
  media: "#8b5cf6", archives: "#f59e0b", documents: "#3b82f6", code: "#10b981", other: "#94a3b8",
};
export function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB`
    : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(1)} GB`;
}

