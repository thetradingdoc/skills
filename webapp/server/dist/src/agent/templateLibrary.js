"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTemplates = loadTemplates;
exports.recordSuccessfulRun = recordSuccessfulRun;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function getTemplatePath(rootPath) {
    return path.join(rootPath, ".agent", "templates.json");
}
function ensureDir(rootPath) {
    const dir = path.join(rootPath, ".agent");
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
function loadTemplates(rootPath) {
    ensureDir(rootPath);
    const p = getTemplatePath(rootPath);
    if (!fs.existsSync(p)) {
        const empty = { templates: [] };
        fs.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
        return empty;
    }
    try {
        const raw = fs.readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && Array.isArray(parsed.templates)
            ? parsed
            : { templates: [] };
    }
    catch {
        const empty = { templates: [] };
        fs.writeFileSync(p, JSON.stringify(empty, null, 2), "utf-8");
        return empty;
    }
}
function recordSuccessfulRun(params) {
    const store = loadTemplates(params.rootPath);
    const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rec = {
        id,
        intent: params.intent,
        model: params.model,
        usedCritic: params.usedCritic,
        score: params.score,
        createdAt: new Date().toISOString(),
        questionSample: params.question.slice(0, 200),
    };
    store.templates.push(rec);
    const p = getTemplatePath(params.rootPath);
    fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf-8");
}
