import type { Language } from "../../i18n";
import type {
  Workspace,
  DocumentItem,
  NativeDocument,
  DeliverableRequirement,
  DeliverableReviewFinding,
} from "../../types";

export interface ContextualSuggestion {
  id: string;
  label: string;
  prompt: string;
}

export function getContextualSuggestions(params: {
  workspace: Workspace | null;
  sources: DocumentItem[];
  requirements: DeliverableRequirement[];
  openFindings: DeliverableReviewFinding[];
  activeArtifact: NativeDocument | null;
  language: Language;
}): ContextualSuggestion[] {
  const {
    workspace,
    sources,
    requirements: _requirements,
    openFindings,
    activeArtifact,
    language,
  } = params;

  const wsName = workspace?.name || "Workspace";
  const suggestions: ContextualSuggestion[] = [];

  // Helper to truncate text
  const truncate = (s: string, len: number) =>
    s.length > len ? s.slice(0, len - 2) + "…" : s;

  // -------------------------------------------------------------
  // CHIP 1: Evidence Verification / Open Finding (if any flagged claim)
  // -------------------------------------------------------------
  if (openFindings.length > 0) {
    const finding = openFindings[0];
    const rawClaim = finding.claim_text || "unsupported claim";
    const claimExcerpt = truncate(rawClaim, 30);

    if (language === "vi") {
      suggestions.push({
        id: "audit-finding",
        label: `Xác thực: "${claimExcerpt}"`,
        prompt: `Kiểm toán và tìm bằng chứng nguồn để xác thực hoặc chỉnh sửa tuyên bố: "${rawClaim}" trong ${wsName}.`,
      });
    } else {
      suggestions.push({
        id: "audit-finding",
        label: `Verify: "${claimExcerpt}"`,
        prompt: `Audit and find source evidence to verify or fix the claim: "${rawClaim}" in ${wsName}.`,
      });
    }
  }

  // -------------------------------------------------------------
  // Sources present: Deep contextual synthesis
  // -------------------------------------------------------------
  if (sources.length >= 2) {
    const doc1 = sources[0].display_title || sources[0].filename;
    const doc2 = sources[1].display_title || sources[1].filename;
    const doc1Short = truncate(doc1, 18);
    const doc2Short = truncate(doc2, 18);

    if (language === "vi") {
      suggestions.push({
        id: "compare-sources",
        label: `So sánh ${doc1Short} & ${doc2Short}`,
        prompt: `So sánh và đối chiếu luận điểm, phương pháp và bằng chứng giữa '${doc1}' và '${doc2}'. Nêu rõ điểm tương đồng và khác biệt với trích dẫn trang cụ thể.`,
      });
      suggestions.push({
        id: "cross-source-synthesis",
        label: `Tổng hợp từ ${sources.length} tài liệu`,
        prompt: `Tổng hợp các chủ đề chính và phát hiện cốt lõi trên toàn bộ ${sources.length} tài liệu đã chọn trong ${wsName}. Trích dẫn chính xác số trang.`,
      });
      suggestions.push({
        id: "study-guide-faq",
        label: `Cẩm nang học tập & FAQ`,
        prompt: `Tạo cẩm nang học tập (Study Guide), bảng thuật ngữ và danh sách câu hỏi thường gặp (FAQ) dựa trên các tài liệu đã chọn.`,
      });
      suggestions.push({
        id: "executive-briefing",
        label: `Bản tóm tắt điều hành`,
        prompt: `Soạn bản tóm tắt điều hành (Executive Briefing) cô đọng các phát hiện và số liệu chính từ các nguồn nghiên cứu trong ${wsName}.`,
      });
    } else {
      suggestions.push({
        id: "compare-sources",
        label: `Compare ${doc1Short} & ${doc2Short}`,
        prompt: `Compare and cross-reference perspectives, methodologies, and findings between '${doc1}' and '${doc2}'. Highlight areas of consensus, contradictions, and cite exact pages.`,
      });
      suggestions.push({
        id: "cross-source-synthesis",
        label: `Synthesize all ${sources.length} sources`,
        prompt: `Synthesize the overarching themes, arguments, and conclusions across all ${sources.length} selected sources in ${wsName}. Group by theme with verified page citations.`,
      });
      suggestions.push({
        id: "study-guide-faq",
        label: `Study Guide & FAQ`,
        prompt: `Generate a comprehensive Study Guide, key concept breakdown, and FAQ based on all selected sources in ${wsName}. Cite exact source pages.`,
      });
      suggestions.push({
        id: "executive-briefing",
        label: `Executive Briefing`,
        prompt: `Draft a high-level executive briefing summarizing the main insights, core data, and actionable takeaways from the selected sources in ${wsName}.`,
      });
    }
  } else if (sources.length === 1) {
    const doc = sources[0].display_title || sources[0].filename;
    const docShort = truncate(doc, 22);

    if (language === "vi") {
      suggestions.push({
        id: "doc-synthesis",
        label: `Tổng hợp từ ${docShort}`,
        prompt: `Phân tích tài liệu nguồn '${doc}' và tổng hợp các luận điểm, kết luận và phát hiện cốt lõi với trích dẫn trang cụ thể.`,
      });
      suggestions.push({
        id: "doc-methodology",
        label: `Phương pháp & Bằng chứng trong ${docShort}`,
        prompt: `Trích xuất và đánh giá phương pháp nghiên cứu, dữ liệu và bằng chứng then chốt trong '${doc}'.`,
      });
      suggestions.push({
        id: "study-guide-faq",
        label: `Cẩm nang học tập & FAQ`,
        prompt: `Tạo cẩm nang học tập (Study Guide) và các câu hỏi thường gặp (FAQ) dựa trên nội dung '${doc}'.`,
      });
      suggestions.push({
        id: "executive-briefing",
        label: `Bản tóm tắt điều hành`,
        prompt: `Soạn bản tóm tắt điều hành (Executive Briefing) cô đọng từ '${doc}' cho ${wsName}.`,
      });
    } else {
      suggestions.push({
        id: "doc-synthesis",
        label: `Synthesize findings from ${docShort}`,
        prompt: `Analyze the source document '${doc}' and synthesize its core arguments, key findings, and conclusions. Include page-level citations for every claim.`,
      });
      suggestions.push({
        id: "doc-methodology",
        label: `Methodology & data in ${docShort}`,
        prompt: `Extract and analyze the research methodology, data metrics, and key evidence presented in '${doc}'. Identify any notable limitations or findings.`,
      });
      suggestions.push({
        id: "study-guide-faq",
        label: `Study Guide & FAQ for ${docShort}`,
        prompt: `Generate a comprehensive Study Guide, key concept breakdown, and FAQ based on '${doc}'. Cite exact source pages.`,
      });
      suggestions.push({
        id: "executive-briefing",
        label: `Executive Briefing`,
        prompt: `Draft a concise executive briefing summarizing the key insights and actionable takeaways from '${doc}' for ${wsName}.`,
      });
    }
  } else {
    // No sources uploaded yet
    const artTitle = activeArtifact?.title || wsName;
    const artShort = truncate(artTitle, 20);

    if (language === "vi") {
      suggestions.push({
        id: "init-structure",
        label: `Cấu trúc nghiên cứu cho ${artShort}`,
        prompt: `Đề xuất khung đề mục và cấu trúc nghiên cứu có hệ thống cho ${wsName}.`,
      });
      suggestions.push({
        id: "research-questions",
        label: `Câu hỏi nghiên cứu cốt lõi`,
        prompt: `Đề xuất danh sách các câu hỏi nghiên cứu cốt lõi cần giải quyết cho ${wsName}.`,
      });
    } else {
      suggestions.push({
        id: "init-structure",
        label: `Research outline for ${artShort}`,
        prompt: `Propose a structured research outline and section hierarchy for ${wsName}.`,
      });
      suggestions.push({
        id: "research-questions",
        label: `Key Research Questions`,
        prompt: `Draft the essential research questions and investigation topics to guide document collection for ${wsName}.`,
      });
    }
  }

  return suggestions;
}
