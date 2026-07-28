/**
 * Condense the agent inventory into prose the model can reason over.
 * Summary only - specifics come from retrieval, so answers stay traceable.
 */
export function summariseAgentInventory(graph: any): string | undefined {
  const inv = graph && graph.agents;
  const list = inv && inv.agents;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const catalogs = inv.toolCatalogs || {};
  const toolsOf = (a: any) => Array.isArray(a.tools) ? a.tools : (a.catalogId ? (catalogs[a.catalogId] || []) : []);
  const agents = list.filter((a: any) => a.kind === "agent");
  const helpers = list.filter((a: any) => a.kind === "helper").length;
  const unknown = list.filter((a: any) => a.kind === "unknown").length;
  const L: string[] = [];
  L.push("## Agent inventory (from this scan)");
  L.push(agents.length + " agent surfaces, " + helpers + " LLM helpers without tools, " + unknown + " unclassified.");
  if (Array.isArray(inv.pythonAgents) && inv.pythonAgents.length) {
    L.push("NOT SCANNED: " + inv.pythonAgents.length + " Python agent file(s): " + inv.pythonAgents.join(", "));
  }
  L.push("");
  for (const a of agents) {
    const tools = toolsOf(a);
    const rc = (cls: string) => tools.filter((t: any) => t && t.reach && t.reach.cells && t.reach.cells[cls] && t.reach.cells[cls].state === "reaches").length;
    let untraced = 0;
    for (const t of tools) {
      const cells = (t && t.reach && t.reach.cells) || {};
      for (const k of Object.keys(cells)) { if (cells[k] && cells[k].state === "not-traced") untraced++; }
    }
    L.push("### " + a.file);
    L.push("provider=" + a.provider + " loop=" + (a.loopKind || "unknown") + " model=" + (a.model || "not determinable") + " tools=" + tools.length);
    L.push("reach: " + rc("patient") + " tools reach patient data, " + rc("money") + " reach money, " + rc("external") + " reach external services. " + untraced + " cells could not be traced.");
    L.push(a.auth && a.auth.found ? ("auth: " + (a.auth.location || "found")) : "auth: NO authentication found before tool execution.");
    const layers = a.layers;
    if (layers && typeof layers === "object") {
      const filled: string[] = []; const missing: string[] = [];
      for (const k of Object.keys(layers)) {
        const v = layers[k];
        const st = v && v.status;
        const nm = (v && (v.id || v.layer || v.name)) || k;
        if (st === "empty" || st === "unsearched") missing.push(nm + " (" + st + ")");
        else filled.push(nm + " " + ((v && v.components && v.components.length) || ""));
      }
      if (filled.length) L.push("layers present: " + filled.join(", "));
      if (missing.length) L.push("layers MISSING: " + missing.join(", "));
    }
    const names = tools.slice(0, 40).map((t: any) => t.name).filter(Boolean);
    if (names.length) L.push("tools: " + names.join(", ") + (tools.length > names.length ? (" (+" + (tools.length - names.length) + " more)") : ""));
    L.push("");
  }
  L.push("Answer only from the facts above and from files you retrieve. Do not assert that a tool reaches a resource unless it is stated here or proven by a file you read. Where a cell is not-traced, say so rather than assuming it is clear.");
  return L.join("\n");
}
