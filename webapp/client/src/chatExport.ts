/**
 * Getting a conversation out of the tool.
 *
 * Chat already survives a reload, but a conversation you cannot take
 * anywhere is scrollback rather than a record. Several sessions in this tool
 * have produced findings worth keeping — what a typecheck actually returned,
 * why a resource was classified as patient — and those currently live only
 * in a panel.
 *
 * Markdown because it pastes into a pull request, an issue, a document, or
 * back into a model without losing structure.
 */

type Message = {
  role: string;
  content?: string;
  citations?: Array<{ label?: string; nodeId?: string }>;
  criticReport?: string;
  criticScore?: number;
  confidence?: number;
};

const stamp = (d: Date): string =>
  d.getFullYear() +
  "-" +
  String(d.getMonth() + 1).padStart(2, "0") +
  "-" +
  String(d.getDate()).padStart(2, "0");

/**
 * One conversation as markdown.
 *
 * Critic reports and confidence are included because they are part of what
 * the tool said — an answer at 40% confidence reads differently from the same
 * answer at 100%, and stripping that out would make the record more confident
 * than the conversation was.
 */
export function chatToMarkdown(
  messages: Message[],
  opts: { title?: string; repo?: string } = {}
): string {
  const L: string[] = [];
  const now = new Date();

  L.push("# " + (opts.title ?? "Conversation"));
  L.push("");
  if (opts.repo) L.push("Repository: `" + opts.repo + "`  ");
  L.push("Exported " + stamp(now) + " from blanko");
  L.push("");
  L.push("---");
  L.push("");

  for (const m of messages) {
    if (!m.content?.trim()) continue;

    if (m.role === "user") {
      L.push("### Question");
      L.push("");
      L.push(m.content.trim());
      L.push("");
      continue;
    }

    if (m.role === "critic") {
      L.push("> **Critic**" + (m.criticScore != null ? " — " + m.criticScore + "/10" : ""));
      L.push(">");
      for (const line of m.content.trim().split("\n")) {
        L.push("> " + line);
      }
      L.push("");
      continue;
    }

    L.push("### Answer");
    L.push("");
    L.push(m.content.trim());
    L.push("");

    if (m.confidence != null) {
      L.push("_Confidence " + Math.round(m.confidence * (m.confidence <= 1 ? 100 : 1)) + "%_");
      L.push("");
    }

    if (m.citations?.length) {
      L.push("<details><summary>Cited components</summary>");
      L.push("");
      for (const c of m.citations) {
        L.push("- `" + (c.nodeId ?? c.label ?? "unknown") + "`");
      }
      L.push("");
      L.push("</details>");
      L.push("");
    }
  }

  L.push("---");
  L.push("");
  L.push(
    "_Answers are grounded in a scan of the repository above. Where the tracer could not establish something, the tool says so rather than treating silence as a clean result._"
  );

  return L.join("\n");
}

/** A single message, for pasting into an issue or a document. */
export function messageToMarkdown(m: Message): string {
  if (!m.content) return "";
  if (m.role === "user") return m.content.trim();

  const L: string[] = [m.content.trim()];
  if (m.citations?.length) {
    L.push("");
    L.push("Cited: " + m.citations.map((c) => c.nodeId ?? c.label).filter(Boolean).join(", "));
  }
  return L.join("\n");
}

/** A filename that sorts sensibly and says what it is. */
export function chatFilename(title?: string, repo?: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);

  const parts = [stamp(new Date())];
  if (repo) parts.push(slug(repo.split("/").pop() ?? repo));
  parts.push(slug(title ?? "conversation"));
  return parts.filter(Boolean).join("-") + ".md";
}
