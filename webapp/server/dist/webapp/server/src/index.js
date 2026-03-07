import "./loadEnv.js";
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
import { shareRoutes } from "./shareRoutes.js";
import { metricsRoutes } from "./metrics.js";
import { taskRoutes } from "./taskRoutes.js";
import { violationsRoutes } from "./violations.js";
import { railsRoutes } from "./railsRoutes.js";
import { greenfieldRoutes } from "./greenfieldRoutes.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../../client/dist");
if (!fs.existsSync(distPath)) {
    console.warn(`[static] dist not found at ${distPath} — run 'npm run build' in the client`);
}
const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({
    limit: "10mb",
}));
const PORT = process.env.PORT ?? 4000;
app.use("/api", scanRoutes);
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
app.use("/api", shareRoutes);
app.use("/api", metricsRoutes);
app.use("/api", taskRoutes);
app.use("/api", railsRoutes);
app.use("/api", greenfieldRoutes);
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});
app.use(express.static(distPath));
app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
});
app.listen(PORT, () => {
    console.log(`Arch Visualizer API running at http://localhost:${PORT}`);
});
