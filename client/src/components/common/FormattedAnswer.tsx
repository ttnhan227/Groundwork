function InlineText({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>,
  )}</>;
}

export function FormattedAnswer({ content }: { content: string }) {
  const clean = content.replace(/\s*\[Source\s+\d+\]/gi, "").trim();
  return <div className="formatted-answer">{clean.split("\n").map((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return <div className="answer-space" key={index} />;
    if (line.startsWith("### ")) return <h4 key={index}><InlineText text={line.slice(4)} /></h4>;
    if (line.startsWith("## ")) return <h3 key={index}><InlineText text={line.slice(3)} /></h3>;
    if (line.startsWith("# ")) return <h3 key={index}><InlineText text={line.slice(2)} /></h3>;
    if (/^[-*]\s/.test(line)) return <div className="answer-bullet" key={index}><i /><span><InlineText text={line.slice(2)} /></span></div>;
    if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      return <div className="answer-number" key={index}><b>{match?.[1]}</b><span><InlineText text={match?.[2] ?? line} /></span></div>;
    }
    return <p key={index}><InlineText text={line} /></p>;
  })}</div>;
}
