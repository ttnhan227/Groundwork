import React from "react";
import { ShieldCheck } from "lucide-react";
import type { DeliverableRequirement, NativeDocument } from "../../types";

export interface ProvenanceAppendixProps {
  activeArtifact: NativeDocument | null;
  requirements: DeliverableRequirement[];
  readinessScore: number;
}

export const ProvenanceAppendix: React.FC<ProvenanceAppendixProps> = ({
  activeArtifact,
  requirements,
  readinessScore,
}) => {
  return (
    <div className="p-4 space-y-4 min-w-0">
      <div className="flex items-center justify-between pb-2 border-b border-[var(--hairline)] min-w-0">
        <div className="min-w-0">
          <h4 className="font-serif text-sm font-semibold text-[var(--ink)] truncate">
            Evidence appendix
          </h4>
          <p className="text-xs text-[var(--ink-muted)] break-words">
            Requirements and the source records currently linked to them.
          </p>
        </div>
      </div>

      <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--hairline)] shadow-[var(--shadow-subtle)] space-y-3 min-w-0">
        <div className="flex items-center justify-between text-xs font-mono pb-2 border-b border-[var(--hairline-subtle)] min-w-0">
          <span className="text-[var(--ink-muted)] flex-shrink-0">
            Response:
          </span>
          <strong className="text-[var(--ink)] truncate max-w-[160px] ml-2">
            {activeArtifact?.title || "Response draft"}
          </strong>
        </div>

        <div className="overflow-x-auto min-w-0">
          <table className="w-full text-left text-xs border-collapse font-sans min-w-0">
            <thead>
              <tr className="border-b border-[var(--hairline)] text-[10px] font-mono text-[var(--ink-muted)] uppercase">
                <th className="py-1.5 pr-2">Requirement</th>
                <th className="py-1.5 px-2">Evidence Source</th>
                <th className="py-1.5 pl-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline-subtle)] text-[11px]">
              {requirements.map((req, idx) => (
                <tr key={idx}>
                  <td
                    className="py-2 pr-2 font-medium text-[var(--ink)] truncate max-w-[120px] sm:max-w-[140px]"
                    title={req.text}
                  >
                    {req.text}
                  </td>
                  <td className="py-2 px-2 font-mono text-[var(--ink-blue)] truncate max-w-[100px] sm:max-w-[120px]">
                    {req.evidence?.[0]
                      ? `${req.evidence[0].document_name} (p. ${req.evidence[0].page_number})`
                      : "No linked evidence"}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold flex-shrink-0 ${
                        req.status === "covered"
                          ? "bg-[var(--success-bg)] text-[var(--success)]"
                          : "bg-[var(--warning-bg)] text-[var(--warning)]"
                      }`}
                    >
                      {req.status === "covered" ? "Covered" : "Needs review"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Readiness summary */}
        <div className="p-2.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] flex items-center gap-2 text-xs text-[var(--ink-secondary)] min-w-0">
          <ShieldCheck
            size={16}
            className="text-[var(--success)] flex-shrink-0"
          />
          <div className="flex-1 min-w-0 font-mono text-[10px]">
            <p className="font-semibold text-[var(--ink)] truncate">
              Review readiness
            </p>
            <p className="text-[var(--ink-muted)] truncate">
              {readinessScore}% based on requirement coverage and open findings.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProvenanceAppendix;
