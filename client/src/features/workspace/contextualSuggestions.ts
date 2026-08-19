import type { Language } from "../../i18n";
import type { Workspace, DocumentItem, NativeDocument, DeliverableRequirement, DeliverableReviewFinding } from "../../types";

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
  const { workspace, sources, requirements, openFindings, activeArtifact, language } = params;

  const wsName = workspace?.name || "Workspace";
  const firstDoc = sources[0]?.display_title || sources[0]?.filename || "";
  const sourceCount = sources.length;
  const uncoveredReqs = requirements.filter((r) => r.status !== "covered" && r.status !== "waived");

  const suggestions: ContextualSuggestion[] = [];

  // -------------------------------------------------------------
  // CHIP 1: Critical Audit Finding OR Document Proposal Drafting
  // -------------------------------------------------------------
  if (openFindings.length > 0) {
    const finding = openFindings[0];
    const rawClaim = finding.claim_text || "unsupported claim";
    const claimExcerpt = rawClaim.length > 32 ? rawClaim.slice(0, 30) + "…" : rawClaim;

    switch (language) {
      case "vi":
        suggestions.push({
          id: "audit-finding",
          label: `Xác thực: "${claimExcerpt}"`,
          prompt: `Kiểm toán và tìm bằng chứng nguồn để xác thực hoặc chỉnh sửa tuyên bố: "${rawClaim}" trong ${wsName}.`,
        });
        break;
      case "es":
        suggestions.push({
          id: "audit-finding",
          label: `Verificar: "${claimExcerpt}"`,
          prompt: `Auditar y buscar evidencia de respaldo para la afirmación: "${rawClaim}" en ${wsName}.`,
        });
        break;
      case "ja":
        suggestions.push({
          id: "audit-finding",
          label: `記述を検証: "${claimExcerpt}"`,
          prompt: `${wsName} 内の記述「${rawClaim}」を検証し、ソース根拠をもとに修正または裏付けを行ってください。`,
        });
        break;
      case "de":
        suggestions.push({
          id: "audit-finding",
          label: `Behauptung prüfen: "${claimExcerpt}"`,
          prompt: `Prüfe und finde Quellenbelege für die Behauptung: "${rawClaim}" in ${wsName}.`,
        });
        break;
      case "fr":
        suggestions.push({
          id: "audit-finding",
          label: `Vérifier l'affirmation : "${claimExcerpt}"`,
          prompt: `Auditer et trouver des preuves sources pour l'affirmation : "${rawClaim}" dans ${wsName}.`,
        });
        break;
      case "zh":
        suggestions.push({
          id: "audit-finding",
          label: `核实陈述: "${claimExcerpt}"`,
          prompt: `审计并在来源资料中查找支持证据，以核实或修正 ${wsName} 中的陈述: "${rawClaim}"。`,
        });
        break;
      case "ko":
        suggestions.push({
          id: "audit-finding",
          label: `주장 검증: "${claimExcerpt}"`,
          prompt: `${wsName} 내 주장 "${rawClaim}"에 대한 소스 증거를 찾아 검증하거나 수정하세요.`,
        });
        break;
      case "pt":
        suggestions.push({
          id: "audit-finding",
          label: `Verificar declaração: "${claimExcerpt}"`,
          prompt: `Auditar e encontrar evidências para comprovar ou ajustar a afirmação: "${rawClaim}" em ${wsName}.`,
        });
        break;
      default:
        suggestions.push({
          id: "audit-finding",
          label: `Verify: "${claimExcerpt}"`,
          prompt: `Audit and find source evidence to verify or fix the claim: "${rawClaim}" in ${wsName}.`,
        });
        break;
    }
  } else if (firstDoc) {
    const docShort = firstDoc.length > 28 ? firstDoc.slice(0, 25) + "…" : firstDoc;
    switch (language) {
      case "vi":
        suggestions.push({
          id: "draft-from-doc",
          label: `Soạn bản thảo từ ${docShort}`,
          prompt: `Phân tích tài liệu nguồn '${firstDoc}' và soạn thảo bản đề xuất hoàn chỉnh cho ${wsName} với các luận điểm có căn cứ.`,
        });
        break;
      case "es":
        suggestions.push({
          id: "draft-from-doc",
          label: `Redactar desde ${docShort}`,
          prompt: `Analizar el documento fuente '${firstDoc}' y redactar una propuesta técnica fundamentada para ${wsName}.`,
        });
        break;
      case "ja":
        suggestions.push({
          id: "draft-from-doc",
          label: `${docShort} から下書きを作成`,
          prompt: `ソース資料「${firstDoc}」を分析し、${wsName} の根拠に基づく提案書を作成してください。`,
        });
        break;
      case "de":
        suggestions.push({
          id: "draft-from-doc",
          label: `Entwurf aus ${docShort}`,
          prompt: `Analysiere die Quelldatei '${firstDoc}' und erstelle ein quellengestütztes Angebot für ${wsName}.`,
        });
        break;
      case "fr":
        suggestions.push({
          id: "draft-from-doc",
          label: `Rédiger d'après ${docShort}`,
          prompt: `Analyser le document source '${firstDoc}' et rédiger une proposition étayée pour ${wsName}.`,
        });
        break;
      case "zh":
        suggestions.push({
          id: "draft-from-doc",
          label: `基于 ${docShort} 起草提案`,
          prompt: `分析来源文件 '${firstDoc}' 并为 ${wsName} 起草完整的有据可查的技术提案。`,
        });
        break;
      case "ko":
        suggestions.push({
          id: "draft-from-doc",
          label: `${docShort} 기반 초안 작성`,
          prompt: `소스 문서 '${firstDoc}'를 분석하고 ${wsName}에 대한 근거 기반 제안서를 작성하세요.`,
        });
        break;
      case "pt":
        suggestions.push({
          id: "draft-from-doc",
          label: `Elaborar a partir de ${docShort}`,
          prompt: `Analisar o documento '${firstDoc}' e elaborar uma proposta fundamentada para ${wsName}.`,
        });
        break;
      default:
        suggestions.push({
          id: "draft-from-doc",
          label: `Draft proposal from ${docShort}`,
          prompt: `Analyze source document '${firstDoc}' and draft a complete grounded deliverable for ${wsName}.`,
        });
        break;
    }
  } else {
    switch (language) {
      case "vi":
        suggestions.push({
          id: "init-structure",
          label: `Khung tài liệu ${wsName.slice(0, 24)}`,
          prompt: `Đề xuất cấu trúc khung và các mục cần thiết cho ${wsName}.`,
        });
        break;
      case "es":
        suggestions.push({
          id: "init-structure",
          label: `Estructura para ${wsName.slice(0, 24)}`,
          prompt: `Proponer una estructura y esquema de secciones para ${wsName}.`,
        });
        break;
      case "ja":
        suggestions.push({
          id: "init-structure",
          label: `${wsName.slice(0, 20)} の構成案`,
          prompt: `${wsName} に適した章立てとセクション構成を提案してください。`,
        });
        break;
      default:
        suggestions.push({
          id: "init-structure",
          label: `Structure for ${wsName.slice(0, 24)}`,
          prompt: `Propose a structured outline and section hierarchy for ${wsName}.`,
        });
        break;
    }
  }

  // -------------------------------------------------------------
  // CHIP 2: Uncovered Requirement Satisfaction OR Requirement Extraction
  // -------------------------------------------------------------
  if (uncoveredReqs.length > 0) {
    const req = uncoveredReqs[0];
    const rawReq = req.text || "client requirement";
    const reqExcerpt = rawReq.length > 32 ? rawReq.slice(0, 30) + "…" : rawReq;

    switch (language) {
      case "vi":
        suggestions.push({
          id: "satisfy-req",
          label: `Đáp ứng: "${reqExcerpt}"`,
          prompt: `Tìm bằng chứng trong tài liệu nguồn để đáp ứng yêu cầu: "${rawReq}" và soạn mục giải trình tương ứng.`,
        });
        break;
      case "es":
        suggestions.push({
          id: "satisfy-req",
          label: `Cumplir: "${reqExcerpt}"`,
          prompt: `Buscar evidencia en las fuentes para satisfacer el requisito: "${rawReq}" y redactar la sección correspondiente.`,
        });
        break;
      case "ja":
        suggestions.push({
          id: "satisfy-req",
          label: `要件充足: "${reqExcerpt}"`,
          prompt: `ソース資料から要件「${rawReq}」を裏付ける根拠を探し、対応するセクションを執筆してください。`,
        });
        break;
      case "de":
        suggestions.push({
          id: "satisfy-req",
          label: `Anforderung erfüllen: "${reqExcerpt}"`,
          prompt: `Finde Belege in den Quellen, um die Anforderung "${rawReq}" zu erfüllen, und verfasse den Abschnitt.`,
        });
        break;
      case "fr":
        suggestions.push({
          id: "satisfy-req",
          label: `Satisfaire : "${reqExcerpt}"`,
          prompt: `Trouver des preuves dans les sources pour satisfaire l'exigence "${rawReq}" et rédiger la section correspondante.`,
        });
        break;
      case "zh":
        suggestions.push({
          id: "satisfy-req",
          label: `满足要求: "${reqExcerpt}"`,
          prompt: `在来源资料中寻找证据以满足要求: "${rawReq}"，并撰写对应的阐述章节。`,
        });
        break;
      case "ko":
        suggestions.push({
          id: "satisfy-req",
          label: `요구사항 충족: "${reqExcerpt}"`,
          prompt: `소스 자료에서 요구사항 "${rawReq}"에 대한 증거를 찾고 해당 섹션을 작성하세요.`,
        });
        break;
      case "pt":
        suggestions.push({
          id: "satisfy-req",
          label: `Atender: "${reqExcerpt}"`,
          prompt: `Encontrar evidências nas fontes para cumprir o requisito "${rawReq}" e redigir a seção correspondente.`,
        });
        break;
      default:
        suggestions.push({
          id: "satisfy-req",
          label: `Satisfy: "${reqExcerpt}"`,
          prompt: `Find evidence in active sources to satisfy client requirement "${rawReq}" and draft the corresponding section.`,
        });
        break;
    }
  } else if (firstDoc) {
    const docShort = firstDoc.length > 28 ? firstDoc.slice(0, 25) + "…" : firstDoc;
    switch (language) {
      case "vi":
        suggestions.push({
          id: "extract-reqs",
          label: `Trích xuất yêu cầu từ ${docShort}`,
          prompt: `Trích xuất tất cả yêu cầu kỹ thuật, tiêu chuẩn nghiệm thu và cam kết SLA từ tệp ${firstDoc}.`,
        });
        break;
      case "es":
        suggestions.push({
          id: "extract-reqs",
          label: `Extraer requisitos de ${docShort}`,
          prompt: `Extraer todos los requisitos técnicos, criterios de aceptación y SLA del archivo ${firstDoc}.`,
        });
        break;
      case "ja":
        suggestions.push({
          id: "extract-reqs",
          label: `${docShort} から要件を抽出`,
          prompt: `ファイル「${firstDoc}」からすべての技術要件、検収基準、SLA制約を抽出してください。`,
        });
        break;
      case "de":
        suggestions.push({
          id: "extract-reqs",
          label: `Anforderungen aus ${docShort} extrahieren`,
          prompt: `Extrahiere alle technischen Anforderungen und SLA-Kriterien aus ${firstDoc}.`,
        });
        break;
      case "fr":
        suggestions.push({
          id: "extract-reqs",
          label: `Extraire exigences de ${docShort}`,
          prompt: `Extraire toutes les exigences techniques, critères d'acceptation et SLA de ${firstDoc}.`,
        });
        break;
      case "zh":
        suggestions.push({
          id: "extract-reqs",
          label: `从 ${docShort} 提取要求`,
          prompt: `从文件 ${firstDoc} 中提取所有技术要求、验收标准与 SLA 约束。`,
        });
        break;
      case "ko":
        suggestions.push({
          id: "extract-reqs",
          label: `${docShort}에서 요구사항 추출`,
          prompt: `파일 ${firstDoc}에서 모든 기술 요구사항, 인수 기준 및 SLA를 추출하세요.`,
        });
        break;
      case "pt":
        suggestions.push({
          id: "extract-reqs",
          label: `Extrair requisitos de ${docShort}`,
          prompt: `Extrair todos os requisitos técnicos, critérios de aceite e SLAs do arquivo ${firstDoc}.`,
        });
        break;
      default:
        suggestions.push({
          id: "extract-reqs",
          label: `Extract requirements from ${docShort}`,
          prompt: `Extract all technical requirements, acceptance criteria, and SLA constraints from ${firstDoc}.`,
        });
        break;
    }
  } else {
    switch (language) {
      case "vi":
        suggestions.push({
          id: "audit-grounding",
          label: "Kiểm toán đối chiếu căn cứ",
          prompt: `Đối chiếu nội dung bản thảo ${wsName} với các tiêu chuẩn kỹ thuật.`,
        });
        break;
      default:
        suggestions.push({
          id: "audit-grounding",
          label: "Audit Source Grounding",
          prompt: `Audit and cross-check the draft of ${wsName} against technical standards.`,
        });
        break;
    }
  }

  // -------------------------------------------------------------
  // CHIP 3: Executive Summary / Section Synthesis
  // -------------------------------------------------------------
  const artifactName = activeArtifact?.title || wsName;
  const artifactShort = artifactName.length > 24 ? artifactName.slice(0, 22) + "…" : artifactName;

  switch (language) {
    case "vi":
      suggestions.push({
        id: "executive-summary",
        label: `Tóm tắt điều hành cho ${artifactShort}`,
        prompt: `Soạn phần Tóm tắt Điều hành (Executive Summary) cô đọng cho ${wsName} dựa trên các tài liệu đã phân tích.`,
      });
      break;
    case "es":
      suggestions.push({
        id: "executive-summary",
        label: `Resumen ejecutivo para ${artifactShort}`,
        prompt: `Redactar un resumen ejecutivo conciso para ${wsName} basado en la evidencia analizada.`,
      });
      break;
    case "ja":
      suggestions.push({
        id: "executive-summary",
        label: `${artifactShort} のエグゼクティブ要約`,
        prompt: `分析されたソース根拠に基づき、${wsName} のエグゼクティブ向けサマリーを作成してください。`,
      });
      break;
    case "de":
      suggestions.push({
        id: "executive-summary",
        label: `Management-Zusammenfassung (${artifactShort})`,
        prompt: `Verfasse eine prägnante Management-Zusammenfassung für ${wsName} auf Basis der analysierten Belege.`,
      });
      break;
    case "fr":
      suggestions.push({
        id: "executive-summary",
        label: `Synthèse exécutive (${artifactShort})`,
        prompt: `Rédiger une synthèse exécutive concise pour ${wsName} basée sur les preuves analysées.`,
      });
      break;
    case "zh":
      suggestions.push({
        id: "executive-summary",
        label: `${artifactShort} 高管简报`,
        prompt: `基于已分析的来源证据，为 ${wsName} 起草一份精炼的高管执行摘要 (Executive Summary)。`,
      });
      break;
    case "ko":
      suggestions.push({
        id: "executive-summary",
        label: `${artifactShort} 경영진 요약`,
        prompt: `분석된 소스 증거를 바탕으로 ${wsName}에 대한 경영진 요약(Executive Summary)을 작성하세요.`,
      });
      break;
    case "pt":
      suggestions.push({
        id: "executive-summary",
        label: `Resumo executivo (${artifactShort})`,
        prompt: `Redigir um resumo executivo conciso para ${wsName} com base nas evidências analisadas.`,
      });
      break;
    default:
      suggestions.push({
        id: "executive-summary",
        label: `Executive Summary for ${artifactShort}`,
        prompt: `Draft a concise Executive Summary for ${wsName} based on the analyzed source evidence and key deliverables.`,
      });
      break;
  }

  return suggestions;
}
