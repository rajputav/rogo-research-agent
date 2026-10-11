/**
 * Rehype plugin that wraps the agent's inline citations ([Financials: ACME FY2025],
 * [Profile: GLBX], [DOC-GLBX-002]) in <span class="cite"> so they render as source tags.
 */

const CITATION = /\[(?:Financials|Profile):[^\]\n]+\]|\[DOC-[A-Z0-9-]+\]/g;

interface Node {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

function splitText(value: string): Node[] {
  const nodes: Node[] = [];
  let last = 0;
  for (const match of value.matchAll(CITATION)) {
    const start = match.index!;
    if (start > last) nodes.push({ type: "text", value: value.slice(last, start) });
    nodes.push({
      type: "element",
      tagName: "span",
      properties: { className: ["cite"] },
      children: [{ type: "text", value: match[0].slice(1, -1) }],
    });
    last = start + match[0].length;
  }
  if (last < value.length) nodes.push({ type: "text", value: value.slice(last) });
  return nodes;
}

function walk(node: Node) {
  if (!node.children || node.tagName === "code" || node.tagName === "pre") return;
  node.children = node.children.flatMap((child) =>
    child.type === "text" && child.value ? splitText(child.value) : (walk(child), [child]),
  );
}

export function rehypeCitations() {
  return (tree: Node) => walk(tree);
}
