// Tiny markdown-lite renderer tuned for what Claude produces in chat:
// paragraphs, bullet/numbered lists, bold, inline code, and pipe tables.
// Avoids adding a markdown library to keep the bundle small.

const BOLD_RE = /\*\*(.+?)\*\*/g;
const CODE_RE = /`([^`]+?)`/g;

// Render inline formatting (bold + inline code). Returns an array of
// React children. Order: code first (so we don't re-format inside
// backticks), then bold inside the resulting plain segments.
function renderInline(text, keyBase) {
  const parts = [];
  let last = 0;
  let match;
  CODE_RE.lastIndex = 0;
  while ((match = CODE_RE.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ code: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return parts.flatMap((p, i) => {
    if (p && typeof p === "object" && p.code !== undefined) {
      return [
        <code
          key={`${keyBase}-c-${i}`}
          className="font-mono text-[12px] bg-paper2 border border-rule rounded px-1 py-0.5"
        >
          {p.code}
        </code>,
      ];
    }
    const segs = [];
    let inLast = 0;
    let m;
    BOLD_RE.lastIndex = 0;
    while ((m = BOLD_RE.exec(p))) {
      if (m.index > inLast) segs.push(p.slice(inLast, m.index));
      segs.push(<strong key={`${keyBase}-b-${i}-${m.index}`}>{m[1]}</strong>);
      inLast = m.index + m[0].length;
    }
    if (inLast < p.length) segs.push(p.slice(inLast));
    return segs;
  });
}

function isTableHeader(line, next) {
  if (!line || !next) return false;
  if (!line.includes("|")) return false;
  // Separator row: all cells are dashes (with optional :).
  return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(next);
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

export default function Markdown({ text }) {
  if (!text) return null;
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines.
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Pipe table: header row + separator row + body rows.
    if (isTableHeader(line, lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    // Bullet list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Numbered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Headings (### only — anything bigger feels heavy in chat).
    if (/^#{2,6}\s+/.test(line)) {
      const text = line.replace(/^#{2,6}\s+/, "");
      blocks.push({ type: "h", text });
      i += 1;
      continue;
    }

    // Paragraph — gather consecutive non-blank, non-list lines.
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^#{2,6}\s+/.test(lines[i]) &&
      !isTableHeader(lines[i], lines[i + 1])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }

  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-ink">
      {blocks.map((b, idx) => {
        if (b.type === "p") {
          return (
            <p key={idx}>{renderInline(b.text, `p${idx}`)}</p>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={idx} className="list-disc pl-5 space-y-1">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it, `ul${idx}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={idx} className="list-decimal pl-5 space-y-1">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it, `ol${idx}-${j}`)}</li>
              ))}
            </ol>
          );
        }
        if (b.type === "h") {
          return (
            <h3 key={idx} className="font-display text-base font-semibold mt-3">
              {renderInline(b.text, `h${idx}`)}
            </h3>
          );
        }
        if (b.type === "table") {
          return (
            <div key={idx} className="overflow-x-auto -mx-1 my-1">
              <table className="min-w-full border border-rule text-[12px]">
                <thead>
                  <tr className="bg-paper2">
                    {b.header.map((h, j) => (
                      <th
                        key={j}
                        className="border border-rule px-2 py-1 text-left font-semibold"
                      >
                        {renderInline(h, `th${idx}-${j}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td
                          key={k}
                          className="border border-rule px-2 py-1 align-top"
                        >
                          {renderInline(cell, `td${idx}-${j}-${k}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
