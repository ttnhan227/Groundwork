export type Stats = {
  document_count: number;
  page_count: number;
  storage_bytes: number;
  ai_requests: number;
  generated_files: number;
  failed_jobs: number;
};

export type UsageDetail = {
  storage_limit_bytes: number;
  storage_bytes: number;
  ai_requests_total: number;
  ai_requests_30_days: number;
  ai_requests_by_feature: Record<string, number>;
  jobs_by_status: Record<string, number>;
};
