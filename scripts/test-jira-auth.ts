#!/usr/bin/env npx tsx
/**
 * Test Jira API connectivity.
 * Usage: npx tsx scripts/test-jira-auth.ts [--verbose]
 * Requires: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env
 */

import "dotenv/config";
import { getJiraConfig, jiraFetch } from "../src/jira/client";

async function main() {
  const verbose = process.argv.includes("--verbose");
  const config = getJiraConfig();

  if (!config) {
    console.error("✗ Missing JIRA_BASE_URL, JIRA_EMAIL, or JIRA_API_TOKEN in .env");
    process.exit(1);
  }

  if (verbose) {
    console.log("URL:", `${config.baseUrl.replace(/\/$/, "")}/rest/api/3/myself`);
    console.log("Email:", config.email);
    console.log("Token length:", config.apiToken.length);
  }

  try {
    const res = await jiraFetch(config, "/rest/api/3/myself");
    const body = await res.text();

    if (res.ok) {
      console.log("✓ Jira auth OK");
      process.exit(0);
    } else {
      console.error("✗ Jira auth failed:", res.status);
      if (verbose) {
        console.error("Response:", body);
      } else {
        try {
          const parsed = JSON.parse(body);
          if (parsed.errorMessages?.length) {
            console.error(parsed.errorMessages.join("\n"));
          } else {
            console.error(body.slice(0, 200));
          }
        } catch {
          console.error(body.slice(0, 200));
        }
      }
      process.exit(1);
    }
  } catch (err) {
    console.error("✗ Request failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
