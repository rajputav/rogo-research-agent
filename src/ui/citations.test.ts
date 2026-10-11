import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { rehypeCitations } from "./citations.ts";

const render = (text: string) =>
  renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeCitations] }, text),
  );

describe("rehypeCitations", () => {
  it("wraps each citation style in a cite span", () => {
    const html = render(
      "Revenue grew 2.1% [Financials: GLBX FY2025] per mgmt [DOC-GLBX-001] [Profile: GLBX].",
    );
    expect(html).toBe(
      '<p>Revenue grew 2.1% <span class="cite">Financials: GLBX FY2025</span> per mgmt ' +
        '<span class="cite">DOC-GLBX-001</span> <span class="cite">Profile: GLBX</span>.</p>',
    );
  });

  it("finds citations inside table cells and bold text", () => {
    const html = render(
      "| Metric | GLBX |\n|---|---|\n| Growth | **2.1%** [Financials: GLBX FY2025] |",
    );
    expect(html).toContain("<table>");
    expect(html).toContain('<td><strong>2.1%</strong> <span class="cite">Financials: GLBX FY2025</span></td>');
  });

  it("leaves other bracketed text and code alone", () => {
    const html = render("See [note] and `[DOC-GLBX-001]`.");
    expect(html).toBe("<p>See [note] and <code>[DOC-GLBX-001]</code>.</p>");
  });
});
