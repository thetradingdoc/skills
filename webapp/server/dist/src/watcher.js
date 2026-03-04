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
exports.ProjectWatcher = void 0;
const chokidar = __importStar(require("chokidar"));
const events_1 = require("events");
class ProjectWatcher extends events_1.EventEmitter {
    watcher = null;
    debounceTimer = null;
    DEBOUNCE_MS = 1500;
    start(rootPath) {
        this.watcher = chokidar.watch([
            `${rootPath}/**/*.ts`,
            `${rootPath}/**/*.tsx`,
            `${rootPath}/**/.context.md`,
            `${rootPath}/**/.arch-rules.json`,
        ], {
            ignored: /node_modules|\.git|dist/,
            persistent: true,
            ignoreInitial: true,
        });
        const trigger = () => {
            if (this.debounceTimer)
                clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => this.emit("change"), this.DEBOUNCE_MS);
        };
        this.watcher.on("change", trigger).on("add", trigger).on("unlink", trigger);
    }
    stop() {
        this.watcher?.close();
        this.watcher = null;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }
}
exports.ProjectWatcher = ProjectWatcher;
