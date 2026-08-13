import { describe, expect, it } from "vitest";
import { classifyGithubWebhookEvent } from "./githubWebhook.js";

describe("Gate A github webhook event classification", () => {
  it("treats push/pull_request as scan", () => {
    expect(classifyGithubWebhookEvent("push")).toBe("scan");
    expect(classifyGithubWebhookEvent("pull_request")).toBe("scan");
  });

  it("passthrough installation events without requiring repository (no 400)", () => {
    expect(classifyGithubWebhookEvent("installation")).toBe("installation_passthrough");
    expect(classifyGithubWebhookEvent("installation_repositories")).toBe(
      "installation_passthrough"
    );
  });

  it("ignores other events (ping, etc.)", () => {
    expect(classifyGithubWebhookEvent("ping")).toBe("ignored");
    expect(classifyGithubWebhookEvent(undefined)).toBe("ignored");
  });
});

describe("Gate C authUrl token override", () => {
  it("injects installation token when provided", async () => {
    const { authUrl } = await import("./cloneRepo.js");
    const url = authUrl("https://github.com/acme/repo", "ghs_test_token");
    expect(url).toContain("ghs_test_token@github.com/acme/repo");
  });
});
