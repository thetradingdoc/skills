"use strict";
/**
 * sessionTouchedPaths — AGENT_ROADMAP v4 §4c
 * Phase 1: stub populated on dry-run commits. Phase 2 replaces with real staging.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSessionTouchedPaths = getSessionTouchedPaths;
exports.addTouchedPath = addTouchedPath;
exports.addTouchedPaths = addTouchedPaths;
exports.mockCommit = mockCommit;
exports.clearSessionTouchedPaths = clearSessionTouchedPaths;
const paths = new Set();
function getSessionTouchedPaths() {
    return Array.from(paths);
}
function addTouchedPath(p) {
    paths.add(p);
}
function addTouchedPaths(ps) {
    for (const p of ps)
        paths.add(p);
}
/** Phase 1 stub: simulate a commit by adding paths without writing files. */
function mockCommit(pathsToAdd) {
    addTouchedPaths(pathsToAdd);
}
function clearSessionTouchedPaths() {
    paths.clear();
}
