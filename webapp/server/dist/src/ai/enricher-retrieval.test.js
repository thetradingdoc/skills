"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const enricher_retrieval_1 = require("./enricher-retrieval");
(0, vitest_1.describe)("enricher-retrieval", () => {
    (0, vitest_1.it)("clearPlanCache does not throw", () => {
        (0, vitest_1.expect)(() => (0, enricher_retrieval_1.clearPlanCache)()).not.toThrow();
    });
});
