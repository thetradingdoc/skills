import "./loadEnv.js";
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
import { resourceClassifyRoutes } from "./resourceClassify.js";
import { traceDisputesRoutes } from "./traceDisputes.js";
import { reachRulesRoutes } from "./reachRulesRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../../client/dist");
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
app.use(
  express.json({
    limit: "32mb",
  })
);

const PORT = process.env.PORT ?? 4000;

app.use("/api", scanRoutes);
app.use("/api", resourceClassifyRoutes);
app.use("/api", traceDisputesRoutes);
app.use("/api", reachRulesRoutes);
app.use("/api", chatRoutes);
app.use("/api", fileContentRoutes);
app.use("/api", validateRoutes);
app.use("/api", jiraRoutes);
app.use("/api", jiraViolationRoutes);
app.use("/api", integrationRoutes);
app.use("/api", violationsRoutes);
app.use("/api", scaffoldRoutes);
app.use("/api", materializeRoutes);
app.use("/api", authRoutes);
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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

export { app };

if (!process.env.VITEST) {
  app.listen(PORT, () => {
    console.log(`Arch Visualizer API running at http://localhost:${PORT}`);
  });
}
