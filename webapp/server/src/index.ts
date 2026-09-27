import "./loadEnv.js";
import { attachTerminal, closeAllTerminals } from "./terminalServer.js";
import { registerTodoSessionLogSink } from "./taskSessionLog.js";

registerTodoSessionLogSink();
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import express from "express";
import cors from "cors";
import { scanRoutes } from "./scan.js";
import { chatRoutes } from "./chat.js";
import { fileContentRoutes } from "./fileContent.js";
import { validateRoutes } from "./validate.js";
import { jiraRoutes } from "./jira.js";
import { jiraViolationRoutes } from "./jiraViolation.js";
import { integrationRoutes } from "./integrationRoutes.js";
import { scaffoldRoutes } from "./scaffold.js";
import { materializeRoutes } from "./materialize.js";
import { designMaterializeRoutes } from "./designMaterialize.js";
import { authRoutes } from "./auth.js";
import { workspaceRoutes } from "./workspaces.js";
import { todosRoutes } from "./todos.js";
import { todosImportRoutes } from "./todosImport.js";
import { shareRoutes } from "./shareRoutes.js";
import { metricsRoutes } from "./metrics.js";
import { feedbackRoutes } from "./feedback.js";
import { dependencyRisksRoutes } from "./dependencyRisks.js";
import { telemetryRoutes } from "./telemetryRoutes.js";
import { taskRoutes } from "./taskRoutes.js";
import { violationsRoutes } from "./violations.js";
import { findingsRoutes } from "./findingsRoutes.js";
import { localFileRoutes } from "./localFileRoutes.js";
import { layersRoutes } from "./layersRoutes.js";
import { scanStalenessRoutes } from "./scanStaleness.js";
import { railsRoutes } from "./railsRoutes.js";
import { greenfieldRoutes } from "./greenfieldRoutes.js";
import { chatThreadRoutes } from "./chatThreads.js";
import { userMemoriesRoutes } from "./userMemories.js";
import { activityRoutes } from "./activityLog.js";
import { annotationCommentsRoutes } from "./annotationComments.js";
import { workspaceMembersRoutes } from "./workspaceMembers.js";
import { githubWebhookRoutes } from "./githubWebhook.js";
import { scanHistoryRoutes } from "./scanHistory.js";
import { graphSnapshotsRoutes } from "./graphSnapshots.js";
import { systemModelRoutes } from "./systemModelRoutes.js";
import { repoDiffRoutes } from "./repoDiff.js";
import { githubPrCommentRoutes } from "./githubPrComments.js";
import { githubConnectRoutes } from "./githubConnect.js";
import { soloWorkspaceRoutes } from "./soloWorkspace.js";
import { n8nRoutes } from "./n8nRoutes.js";
import { resourceClassifyRoutes } from "./resourceClassify.js";
import { traceDisputesRoutes } from "./traceDisputes.js";
import { reachRulesRoutes } from "./reachRulesRoutes.js";
import { billingRoutes, handleStripeWebhook } from "./billing.js";
import { githubArchEventsRoutes } from "./githubArchEvents.js";
import { sectionClaimsRoutes } from "./sectionClaims.js";
import { notificationsRoutes } from "./notifications.js";
import { usageRoutes } from "./usageRoutes.js";
import { llmopsRoutes } from "./llmopsRoutes.js";
import { managementRollupRoutes } from "./managementRollupRoutes.js";
import { deployHealthRoutes } from "./deployHealthRoutes.js";
import { agentHarnessRoutes } from "./agentHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Override for containers (e.g. CLIENT_DIST_PATH=/app/webapp/client/dist). */
const distPath = process.env.CLIENT_DIST_PATH?.trim()
  ? path.resolve(process.env.CLIENT_DIST_PATH.trim())
  : path.resolve(__dirname, "../../client/dist");
if (!fs.existsSync(distPath)) {
  console.warn(`[static] dist not found at ${distPath} — run 'npm run build' in the client`);
}

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(
  "/api/webhooks/github",
  express.raw({ type: "application/json", limit: "1mb" }),
  githubWebhookRoutes
);
/** Stripe webhooks need the raw body for signature verification. */
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = req.body as Buffer;
    void handleStripeWebhook(req, res);
  }
);
app.use(
  express.json({
    limit: "32mb",
  })
);

const PORT = process.env.PORT ?? 4000;
// Keep local development bound to loopback; hosted containers can opt into
// their required interface through HOST or NODE_ENV=production.
const HOST = process.env.HOST?.trim() || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

app.use("/api", scanRoutes);
app.use("/api", resourceClassifyRoutes);
app.use("/api", traceDisputesRoutes);
app.use("/api", reachRulesRoutes);
app.use("/api", layersRoutes);
app.use("/api", chatRoutes);
app.use("/api", fileContentRoutes);
app.use("/api", validateRoutes);
app.use("/api", jiraRoutes);
app.use("/api", jiraViolationRoutes);
app.use("/api", integrationRoutes);
app.use("/api", violationsRoutes);
app.use("/api", findingsRoutes);
app.use("/api", localFileRoutes);
app.use("/api", scanStalenessRoutes);
app.use("/api", scaffoldRoutes);
app.use("/api", materializeRoutes);
app.use("/api", designMaterializeRoutes);
app.use("/api", authRoutes);
app.use("/api", billingRoutes);
app.use("/api", workspaceRoutes);
app.use("/api", todosRoutes);
app.use("/api", todosImportRoutes);
app.use("/api", chatThreadRoutes);
app.use("/api", userMemoriesRoutes);
app.use("/api", shareRoutes);
app.use("/api", activityRoutes);
app.use("/api", annotationCommentsRoutes);
app.use("/api", workspaceMembersRoutes);
app.use("/api", scanHistoryRoutes);
app.use("/api", graphSnapshotsRoutes);
app.use("/api", systemModelRoutes);
app.use("/api", repoDiffRoutes);
app.use("/api", githubPrCommentRoutes);
app.use("/api", githubConnectRoutes);
app.use("/api", metricsRoutes);
app.use("/api", taskRoutes);
app.use("/api", greenfieldRoutes);
app.use("/api", railsRoutes);
app.use("/api", feedbackRoutes);
app.use("/api", dependencyRisksRoutes);
app.use("/api", telemetryRoutes);
app.use("/api", soloWorkspaceRoutes);
app.use("/api", n8nRoutes);
app.use("/api", githubArchEventsRoutes);
app.use("/api", sectionClaimsRoutes);
app.use("/api", notificationsRoutes);
app.use("/api", usageRoutes);
app.use("/api", llmopsRoutes);
app.use("/api", managementRollupRoutes);
app.use("/api", deployHealthRoutes);
app.use("/api", agentHarnessRoutes);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

export { app };

if (!process.env.VITEST) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`Arch Visualizer API running at http://${HOST}:${PORT}`);
  });
  // The terminal attaches to the HTTP server rather than to Express, because a
  // websocket upgrade happens below the routing layer. It registers nothing
  // unless TERMINAL_ENABLED=1 and the server is bound to loopback.
  if (process.env.CHAT_DEV_BYPASS === "1") {
    console.warn(
      "[auth] DEV BYPASS ON — unauthenticated localhost requests are treated as a signed-in user. " +
        "Every protected route is open. Unset CHAT_DEV_BYPASS before this is reachable by anything but you."
    );
  }
  attachTerminal(server);
  process.on("SIGINT", () => {
    closeAllTerminals();
    process.exit(0);
  });
}
