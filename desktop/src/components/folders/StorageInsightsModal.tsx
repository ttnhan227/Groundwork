import React, { useState } from "react";
import { Copy, FileText, FolderOpen, ExternalLink, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { api } from "../../services/api";
import { Button, Card, Modal, Badge } from "../ui";

interface DuplicateFile {
  path: string;
  name: string;
  size_bytes: number;
  mtime: number;
  extension: string;
}

interface ExactDuplicateGroup {
  sha256: string;
  size_bytes: number;
  file_count: number;
  potential_waste_bytes: number;
  files: DuplicateFile[];
}

interface SimilarNameGroup {
  base_name: string;
  file_count: number;
  files: DuplicateFile[];
}

interface DuplicatesData {
  exact_duplicates: ExactDuplicateGroup[];
  similar_names: SimilarNameGroup[];
  total_exact_groups: number;
  total_duplicate_files: number;
  total_potential_waste_bytes: number;
  note: string;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(epochSeconds: number): string {
  if (!epochSeconds) return "Unknown date";
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StorageInsightsModal({
  workspaceId,
  workspaceName,
  onClose,
}: {
  workspaceId?: string;
  workspaceName?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<DuplicatesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"exact" | "similar">("exact");
  const [actionNotice, setActionNotice] = useState("");

  const runScan = async () => {
    setLoading(true);
    setError("");
    setActionNotice("");
    try {
      const res = await api.getDuplicates(workspaceId);
      setData(res);
    } catch {
      setError("Failed to analyze storage. Ensure index is available and try again.");
    } finally {
      setLoading(false);
    }
  };

  const openItem = async (filePath: string) => {
    try {
      const res = await api.openFile(filePath);
      if (!res.success) {
        setActionNotice(`Could not open file: ${filePath}`);
      }
    } catch {
      setActionNotice(`Could not open file: ${filePath}`);
    }
  };

  const revealItem = async (filePath: string) => {
    try {
      const res = await api.revealFile(filePath);
      if (!res.success) {
        setActionNotice(`Could not show in folder: ${filePath}`);
      }
    } catch {
      setActionNotice(`Could not show in folder: ${filePath}`);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={workspaceName ? `Storage Insights: ${workspaceName}` : "Storage Insights & Duplicates"}
      maxWidth="lg"
    >
      <div className="space-y-5">
        <p className="text-sm text-[var(--ink-secondary)]">
          Inspect redundant storage and identical files across your folders.
          Detection uses fast size filtering followed by on-demand SHA-256 byte hashing.
          <strong> Non-AI, deterministic, and safe.</strong>
        </p>

        {actionNotice && (
          <div className="p-3 bg-[var(--paper-subtle)] border border-[var(--hairline)] rounded-lg text-sm flex items-center gap-2">
            <AlertCircle size={16} className="text-[var(--ink-secondary)]" />
            <span>{actionNotice}</span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-[var(--danger-bg,rgba(239,68,68,0.1))] border border-[var(--danger)] rounded-lg text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        {!data && !loading && (
          <Card className="py-8 text-center space-y-4">
            <Copy className="mx-auto text-[var(--ink-blue)]" size={36} />
            <div className="space-y-1">
              <h3 className="font-semibold text-base">Check for Duplicates on Demand</h3>
              <p className="text-sm text-[var(--ink-secondary)] max-w-md mx-auto">
                Expensive content hashing is run only when requested. Click below to scan indexed files for byte-for-byte exact duplicates and similar copy names.
              </p>
            </div>
            <Button variant="primary" onClick={runScan}>
              <RefreshCw size={16} />
              Scan Now
            </Button>
          </Card>
        )}

        {loading && (
          <div className="py-12 text-center space-y-3">
            <RefreshCw className="mx-auto animate-spin text-[var(--ink-blue)]" size={32} />
            <p className="text-sm text-[var(--ink-secondary)] font-medium">
              Checking file sizes and verifying SHA-256 checksums on demand…
            </p>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-[var(--paper-subtle)] border border-[var(--hairline)] rounded-lg">
                <p className="text-xs text-[var(--ink-secondary)] uppercase tracking-wider font-semibold">Exact Duplicate Groups</p>
                <p className="text-xl font-bold mt-1 text-[var(--ink-primary)]">{data.total_exact_groups}</p>
                <p className="text-xs text-[var(--ink-secondary)] mt-0.5">{data.total_duplicate_files} total duplicate files</p>
              </div>
              <div className="p-3 bg-[var(--paper-subtle)] border border-[var(--hairline)] rounded-lg">
                <p className="text-xs text-[var(--ink-secondary)] uppercase tracking-wider font-semibold">Potential Storage Saved</p>
                <p className="text-xl font-bold mt-1 text-[var(--ink-blue)]">{formatBytes(data.total_potential_waste_bytes)}</p>
                <p className="text-xs text-[var(--ink-secondary)] mt-0.5">if redundant copies kept</p>
              </div>
              <div className="p-3 bg-[var(--paper-subtle)] border border-[var(--hairline)] rounded-lg">
                <p className="text-xs text-[var(--ink-secondary)] uppercase tracking-wider font-semibold">Similar Filenames</p>
                <p className="text-xl font-bold mt-1 text-[var(--ink-primary)]">{data.similar_names.length}</p>
                <p className="text-xs text-[var(--ink-secondary)] mt-0.5">name patterns & copy suffixes</p>
              </div>
            </div>

            {/* Non-destructive guarantee notice */}
            <div className="p-3 bg-[var(--paper-subtle)] border border-[var(--hairline)] rounded-lg text-xs text-[var(--ink-secondary)] space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-[var(--ink-primary)]">
                <CheckCircle2 size={14} className="text-green-600" />
                <span>Safe & Non-Destructive Review</span>
              </div>
              <p>
                Deletion workflows are deferred until safe recovery is fully verified. Groundwork displays duplicate groups and locations without deleting anything, and never uses AI to label files as "unnecessary".
              </p>
            </div>

            {/* Tabs */}
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("exact")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    activeTab === "exact"
                      ? "bg-[var(--ink-blue)] text-white"
                      : "text-[var(--ink-secondary)] hover:bg-[var(--paper-subtle)]"
                  }`}
                >
                  Exact Duplicates ({data.exact_duplicates.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("similar")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    activeTab === "similar"
                      ? "bg-[var(--ink-blue)] text-white"
                      : "text-[var(--ink-secondary)] hover:bg-[var(--paper-subtle)]"
                  }`}
                >
                  Similar Filenames ({data.similar_names.length})
                </button>
              </div>

              <Button size="sm" variant="ghost" onClick={runScan}>
                <RefreshCw size={14} />
                Re-scan
              </Button>
            </div>

            {/* Tab: Exact Duplicates */}
            {activeTab === "exact" && (
              <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
                {data.exact_duplicates.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[var(--ink-secondary)]">
                    No byte-for-byte exact duplicates found in this folder.
                  </div>
                ) : (
                  data.exact_duplicates.map((group, idx) => (
                    <Card key={group.sha256 || idx} className="p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="neutral">SHA-256 match</Badge>
                          <span className="text-sm font-semibold">{formatBytes(group.size_bytes)} each</span>
                          <span className="text-xs text-[var(--ink-secondary)]">({group.file_count} copies)</span>
                        </div>
                        <span className="text-xs font-medium text-[var(--ink-blue)]">
                          Wasted: {formatBytes(group.potential_waste_bytes)}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {group.files.map((file, fIdx) => (
                          <div
                            key={file.path || fIdx}
                            className="flex items-center justify-between p-2 rounded bg-[var(--paper-subtle)] text-xs border border-[var(--hairline)]"
                          >
                            <div className="flex items-center gap-2 overflow-hidden mr-2">
                              <FileText size={14} className="text-[var(--ink-secondary)] flex-shrink-0" />
                              <div className="truncate">
                                <span className="font-medium text-[var(--ink-primary)]">{file.name}</span>
                                <span className="block text-[11px] text-[var(--ink-secondary)] truncate">
                                  {file.path}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-[11px] text-[var(--ink-secondary)] mr-2 hidden sm:inline">
                                {formatDate(file.mtime)}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openItem(file.path)}
                                title="Open original file"
                              >
                                <ExternalLink size={13} />
                                <span className="hidden sm:inline">Open</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => revealItem(file.path)}
                                title="Show in folder"
                              >
                                <FolderOpen size={13} />
                                <span className="hidden sm:inline">Folder</span>
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            )}

            {/* Tab: Similar Names */}
            {activeTab === "similar" && (
              <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
                {data.similar_names.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[var(--ink-secondary)]">
                    No files with similar copy name patterns found.
                  </div>
                ) : (
                  data.similar_names.map((group, idx) => (
                    <Card key={group.base_name || idx} className="p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="warning">Name similarity</Badge>
                          <span className="text-sm font-semibold truncate max-w-xs">{group.base_name}</span>
                          <span className="text-xs text-[var(--ink-secondary)]">({group.file_count} variants)</span>
                        </div>
                        <span className="text-xs text-[var(--ink-secondary)]">
                          May differ in content
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {group.files.map((file, fIdx) => (
                          <div
                            key={file.path || fIdx}
                            className="flex items-center justify-between p-2 rounded bg-[var(--paper-subtle)] text-xs border border-[var(--hairline)]"
                          >
                            <div className="flex items-center gap-2 overflow-hidden mr-2">
                              <FileText size={14} className="text-[var(--ink-secondary)] flex-shrink-0" />
                              <div className="truncate">
                                <span className="font-medium text-[var(--ink-primary)]">{file.name}</span>
                                <span className="block text-[11px] text-[var(--ink-secondary)] truncate">
                                  {file.path} ({formatBytes(file.size_bytes)})
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-[11px] text-[var(--ink-secondary)] mr-2 hidden sm:inline">
                                {formatDate(file.mtime)}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openItem(file.path)}
                                title="Open original file"
                              >
                                <ExternalLink size={13} />
                                <span className="hidden sm:inline">Open</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => revealItem(file.path)}
                                title="Show in folder"
                              >
                                <FolderOpen size={13} />
                                <span className="hidden sm:inline">Folder</span>
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
