// Jira REST v3 sends rich text as Atlassian Document Format (ADF), a JSON tree. Lumo stores plain text,
// so the compatibility layer converts at the edge. Formatting beyond paragraphs, line breaks and lists is
// flattened to text for now.

export interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  version?: number;
}

export function textToAdf(text: string): AdfNode | null {
  if (!text) return null;
  const paragraphs = text.split(/\n{2,}/).map((para): AdfNode => {
    const lines = para.split("\n");
    const content: AdfNode[] = [];
    lines.forEach((line, i) => {
      if (i > 0) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line });
    });
    return { type: "paragraph", content };
  });
  return { type: "doc", version: 1, content: paragraphs };
}

/** Accepts ADF, a plain string (Jira v2 style) or null. */
export function adfToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return blocks(value as AdfNode).trim();
}

function blocks(node: AdfNode): string {
  switch (node.type) {
    case "doc":
      return (node.content ?? []).map(blocks).filter(Boolean).join("\n\n");
    case "bulletList":
      return (node.content ?? []).map((item) => `- ${blocks(item)}`).join("\n");
    case "orderedList":
      return (node.content ?? []).map((item, i) => `${i + 1}. ${blocks(item)}`).join("\n");
    case "listItem":
      return (node.content ?? []).map(blocks).join("\n");
    case "codeBlock":
      return "```\n" + inline(node) + "\n```";
    case "rule":
      return "---";
    default:
      return inline(node);
  }
}

function inline(node: AdfNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") return String(node.attrs?.text ?? "");
  return (node.content ?? []).map((n) => (n.type === "bulletList" || n.type === "orderedList" ? "\n" + blocks(n) : inline(n))).join("");
}
