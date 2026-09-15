import React from "react";
import type { Citation } from "../../types";
import { renderTextWithCitations } from "./InlineCitation";

function InlineText({
  text,
  citations = [],
  onOpenViewer,
}: {
  text: string;
  citations?: Citation[];
  onOpenViewer?: (docId: string, pageNumber?: number, snippet?: string) => void;
}) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*)/g)
        .map((part, index) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={index}>
              {renderTextWithCitations(part.slice(2, -2), citations, onOpenViewer)}
            </strong>
          ) : (
            <React.Fragment key={index}>
              {renderTextWithCitations(part, citations, onOpenViewer)}
            </React.Fragment>
          ),
        )}
    </>
  );
}

export function FormattedAnswer({
  content,
  citations = [],
  onOpenViewer,
}: {
  content: string;
  citations?: Citation[];
  onOpenViewer?: (docId: string, pageNumber?: number, snippet?: string) => void;
}) {
  const clean = content.replace(/\s*\[Source\s+\d+\]/gi, "").trim();
  return (
    <div className="formatted-answer leading-relaxed">
      {clean.split("\n").map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div className="answer-space h-2" key={index} />;
        if (line.startsWith("### "))
          return (
            <h4 key={index} className="text-xs font-bold text-[var(--ink)] mt-3 mb-1 font-sans">
              <InlineText text={line.slice(4)} citations={citations} onOpenViewer={onOpenViewer} />
            </h4>
          );
        if (line.startsWith("## "))
          return (
            <h3 key={index} className="text-sm font-bold text-[var(--ink)] mt-4 mb-1.5 font-sans">
              <InlineText text={line.slice(3)} citations={citations} onOpenViewer={onOpenViewer} />
            </h3>
          );
        if (line.startsWith("# "))
          return (
            <h2 key={index} className="text-base font-bold text-[var(--ink)] mt-4 mb-2 font-sans">
              <InlineText text={line.slice(2)} citations={citations} onOpenViewer={onOpenViewer} />
            </h2>
          );
        if (/^[-*]\s/.test(line))
          return (
            <div className="answer-bullet flex items-start gap-2 text-xs my-1" key={index}>
              <span className="text-[var(--ink-muted)] mt-0.5">•</span>
              <span className="flex-1">
                <InlineText text={line.slice(2)} citations={citations} onOpenViewer={onOpenViewer} />
              </span>
            </div>
          );
        if (/^\d+\.\s/.test(line)) {
          const match = line.match(/^(\d+)\.\s(.*)$/);
          return (
            <div className="answer-number flex items-start gap-2 text-xs my-1" key={index}>
              <span className="font-mono font-medium text-[var(--ink-muted)] w-4 flex-shrink-0">
                {match?.[1]}.
              </span>
              <span className="flex-1">
                <InlineText text={match?.[2] ?? line} citations={citations} onOpenViewer={onOpenViewer} />
              </span>
            </div>
          );
        }
        return (
          <p key={index} className="text-xs text-[var(--ink)] my-1.5 leading-relaxed">
            <InlineText text={line} citations={citations} onOpenViewer={onOpenViewer} />
          </p>
        );
      })}
    </div>
  );
}

