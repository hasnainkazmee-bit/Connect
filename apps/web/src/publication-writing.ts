export const documentFromText = (text: string) => ({
  type: "doc",
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  })),
});
export function writingText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  return (node.content || [])
    .map(writingText)
    .join(
      ["doc", "blockquote", "bulletList", "orderedList", "listItem"].includes(
        node.type,
      )
        ? "\n"
        : "",
    );
}
export const writingHeadline = (document: any) => {
  const headline =
    writingText(document)
      .split("\n")
      .find((line: string) => line.trim())
      ?.trim()
      .slice(0, 180) || "";
  // API limits count UTF-16 units; never leave half of an emoji at the boundary.
  return /[\uD800-\uDBFF]$/.test(headline) ? headline.slice(0, -1) : headline;
};

function inlineLines(node: any): any[][] | null {
  if (
    !node ||
    !["paragraph", "heading"].includes(node.type) ||
    !(node.content || []).every((child: any) =>
      ["text", "hardBreak"].includes(child.type),
    )
  )
    return null;
  const lines: any[][] = [[]];
  for (const child of node.content || []) {
    if (child.type === "hardBreak") lines.push([]);
    else
      (child.text || "").split("\n").forEach((part: string, i: number) => {
        if (i) lines.push([]);
        if (part) lines[lines.length - 1].push({ ...child, text: part });
      });
  }
  return lines;
}
const joinLines = (lines: any[][]) =>
  lines.flatMap((line, i) => (i ? [{ type: "hardBreak" }, ...line] : line));

// Old title and summary fields become visible, editable writing. Matching prefixes
// are reused when a normalized draft is opened again, rather than duplicated.
export function editableDocument(
  document: any,
  body: string,
  title: string,
  subtitle: string,
) {
  const result = structuredClone(document || documentFromText(body));
  const content = result.content || [];
  const first = content.findIndex((node: any) => writingText(node).trim());
  let cursor = Math.max(0, first);
  let lineCursor = 0;
  for (const [text, type] of [
    [title, "heading"],
    [subtitle, "paragraph"],
  ]) {
    if (!text?.trim()) continue;
    const lines = writingText(content[cursor])
      .split("\n")
      .filter((line) => line.trim());
    const current = lines[lineCursor]?.trim() || "";
    const matches =
      current === text.trim() ||
      (type === "heading" &&
        writingHeadline(documentFromText(current)) === text.trim());
    if (!matches && lineCursor > 0) {
      const richLines = inlineLines(content[cursor]);
      if (richLines) {
        let consumed = 0;
        const at = richLines.findIndex((line) => {
          if (writingText({ content: line }).trim()) consumed++;
          return consumed > lineCursor;
        });
        richLines.splice(at < 0 ? richLines.length : at, 0, [
          { type: "text", text },
        ]);
        content[cursor] = { ...content[cursor], content: joinLines(richLines) };
        lineCursor++;
      } else {
        content.splice(cursor + 1, 0, {
          type: "paragraph",
          content: [{ type: "text", text }],
        });
        cursor += 2;
        lineCursor = 0;
      }
    } else if (!matches) {
      content.splice(cursor, 0, {
        type,
        ...(type === "heading" ? { attrs: { level: 2 } } : {}),
        content: [{ type: "text", text }],
      });
      cursor++;
    } else if (lineCursor + 1 < lines.length) lineCursor++;
    else {
      cursor++;
      lineCursor = 0;
    }
  }
  return { ...result, content };
}

// Only remove an entire plain paragraph/heading when it exactly duplicates a
// separately rendered headline. Images, links, lists and partial matches stay.
export function displayDocument(document: any, title = "", subtitle = "") {
  if (!document) return document;
  const content = [...(document.content || [])];
  for (const text of [title, subtitle]) {
    if (!text) continue;
    const index = content.findIndex((node: any) => writingText(node).trim());
    const node = content[index];
    if (
      node &&
      ["paragraph", "heading"].includes(node.type) &&
      writingText(node).trim() === text.trim() &&
      (node.content || []).every(
        (child: any) => child.type === "text" && !child.marks?.length,
      )
    )
      content.splice(index, 1);
  }
  return { ...document, content };
}

// Present a first writing line as the release headline while retaining its links
// and emphasis. This is a display-only split; the full stored document is intact.
export function publicationPresentation(
  document: any,
  title = "",
  subtitle = "",
) {
  if (!document) return { headline: null, document, excerpt: "" };
  const content = [...(document.content || [])];
  const index = content.findIndex((node: any) => writingText(node).trim());
  const node = content[index];
  let headline = null;
  const lines = inlineLines(node);
  if (title && lines) {
    const lineIndex = lines.findIndex((line) =>
      writingText({ content: line }).trim(),
    );
    if (
      lineIndex >= 0 &&
      writingText({ content: lines[lineIndex] }).trim() === title.trim()
    ) {
      headline = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: lines[lineIndex] },
        ],
      };
      const remainingLines = [
        ...lines.slice(0, lineIndex),
        ...lines.slice(lineIndex + 1),
      ];
      const remaining = joinLines(remainingLines);
      if (remaining.length)
        content[index] = { ...node, type: "paragraph", content: remaining };
      else content.splice(index, 1);
    }
  }
  const bodyDocument = displayDocument(
    { ...document, content },
    headline ? "" : title,
    subtitle,
  );
  return {
    headline,
    document: bodyDocument,
    excerpt: writingText(bodyDocument).trim(),
  };
}
export function inlineImageUrls(document: any): Set<string> {
  const urls = new Set<string>();
  const visit = (node: any) => {
    if (node?.type === "image" && node.attrs?.src) urls.add(node.attrs.src);
    node?.content?.forEach(visit);
  };
  visit(document);
  return urls;
}
