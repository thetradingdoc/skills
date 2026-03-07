"use strict";
/**
 * Greenfield critic playbook — structured rules for evaluating greenfield designs.
 * Injected into reviewGreenfieldAnswer LLM prompt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GREENFIELD_CRITIC_PLAYBOOK = void 0;
exports.getGreenfieldCriticSystemSnippet = getGreenfieldCriticSystemSnippet;
exports.GREENFIELD_CRITIC_PLAYBOOK = `
## Greenfield design review rules

1. **Layer boundaries**
   - Presentation must not depend on Data Access or Infrastructure.
   - Business Logic may depend on Data Access; Data Access must not depend on Business Logic.
   - External Services and Infrastructure are lowest; dependencies must point upward only.

2. **Archetype validation**
   - If the user asked for a "SaaS web app", expect Presentation, API/Orchestration, and at least one Business Logic layer.
   - If "API service", expect no Presentation or a thin gateway only; focus on API and downstream layers.
   - If "data pipeline", expect clear flow from ingestion through processing to output; no circular data flow.

3. **Node count and depth**
   - Prefer 5–15 modules for a focused design; flag if >25 without clear justification.
   - Each layer should have at least one node; avoid single-node layers unless it's a gateway.

4. **Naming and coherence**
   - Node IDs and labels should be PascalCase or kebab-case; no spaces or special characters in IDs.
   - Names should reflect responsibility (e.g. AuthService, not Module1).

5. **Circular dependencies**
   - No cycle in the dependency graph. If A→B→C→A, the design is invalid.

6. **Negative examples (avoid)**
   - Monolithic "God" node that does everything.
   - Presentation directly calling Infrastructure.
   - Missing clear API/orchestration layer between UI and backend.
`.trim();
function getGreenfieldCriticSystemSnippet(antiPatternWarnings) {
    if (antiPatternWarnings.length === 0)
        return exports.GREENFIELD_CRITIC_PLAYBOOK;
    return (exports.GREENFIELD_CRITIC_PLAYBOOK +
        "\n\n## Past failures to avoid\n" +
        antiPatternWarnings.map((w) => `- ${w}`).join("\n"));
}
