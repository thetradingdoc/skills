"use strict";
/**
 * Jira REST API client — uses JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN from env.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRepoNameFromGit = getRepoNameFromGit;
exports.getJiraConfig = getJiraConfig;
exports.jiraFetch = jiraFetch;
exports.testJiraAuth = testJiraAuth;
exports.listProjects = listProjects;
exports.getProjectIssueTypes = getProjectIssueTypes;
exports.createIssue = createIssue;
exports.searchIssues = searchIssues;
exports.getIssue = getIssue;
exports.updateIssueDescription = updateIssueDescription;
exports.addLabel = addLabel;
exports.transitionIssue = transitionIssue;
const child_process_1 = require("child_process");
/** Extract repo name from git remote (e.g. doclittle-platform from github.com/owner/doclittle-platform) */
function getRepoNameFromGit(dir) {
    try {
        const proc = (0, child_process_1.spawnSync)("git", ["remote", "get-url", "origin"], {
            cwd: dir,
            encoding: "utf-8",
            maxBuffer: 4096,
        });
        const url = proc.stdout?.trim();
        if (!url)
            return null;
        const match = url.match(/(?:github\.com[/:]|gitlab\.com[/:]|bitbucket\.org[/:])[\w.-]+\/([\w.-]+?)(?:\.git)?\/?$/i);
        return match?.[1] ?? null;
    }
    catch {
        return null;
    }
}
function getJiraConfig() {
    const baseUrl = process.env.JIRA_BASE_URL?.trim();
    const email = process.env.JIRA_EMAIL?.trim();
    const apiToken = process.env.JIRA_API_TOKEN?.trim();
    if (!baseUrl || !email || !apiToken)
        return null;
    return { baseUrl, email, apiToken };
}
function authHeader(config) {
    const encoded = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
    return `Basic ${encoded}`;
}
async function jiraFetch(config, path, options = {}) {
    const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
    return fetch(url, {
        ...options,
        headers: {
            "Authorization": authHeader(config),
            "Accept": "application/json",
            "Content-Type": "application/json",
            ...options.headers,
        },
    });
}
/** Verify Jira credentials by fetching current user */
async function testJiraAuth() {
    const config = getJiraConfig();
    if (!config) {
        return { success: false, error: "Missing JIRA_BASE_URL, JIRA_EMAIL, or JIRA_API_TOKEN in .env" };
    }
    try {
        const res = await jiraFetch(config, "/rest/api/3/myself");
        if (!res.ok) {
            const body = await res.text();
            return { success: false, error: `Jira API ${res.status}: ${body}` };
        }
        return { success: true };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
    }
}
/** List accessible projects */
async function listProjects(config) {
    const res = await jiraFetch(config, "/rest/api/3/project");
    if (!res.ok)
        throw new Error(`Jira projects ${res.status}: ${await res.text()}`);
    const data = (await res.json());
    return data.map((p) => ({ key: p.key, name: p.name }));
}
/** Get creatable issue types for a project */
async function getProjectIssueTypes(config, projectKey) {
    const res = await jiraFetch(config, `/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
    if (!res.ok)
        return ["Task"];
    const data = (await res.json());
    const types = data.projects?.[0]?.issuetypes ?? [];
    return types.map((t) => t.name);
}
/** Create a Jira issue */
async function createIssue(config, input) {
    let issueType = input.issueType ?? process.env.JIRA_ISSUE_TYPE ?? "Task";
    const validTypes = await getProjectIssueTypes(config, input.projectKey);
    if (!validTypes.includes(issueType)) {
        issueType = validTypes[0] ?? "Task";
    }
    const fields = {
        project: { key: input.projectKey },
        summary: input.summary,
        issuetype: { name: issueType },
    };
    if (input.priority) {
        fields.priority = { name: input.priority };
    }
    if (input.description) {
        fields.description = { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: input.description }] }] };
    }
    if (input.labels && input.labels.length > 0) {
        fields.labels = input.labels;
    }
    const res = await jiraFetch(config, "/rest/api/3/issue", {
        method: "POST",
        body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Jira create issue ${res.status}: ${body}`);
    }
    const data = (await res.json());
    return { key: data.key };
}
/** Search Jira issues via JQL (uses /rest/api/3/search/jql) */
async function searchIssues(config, jql, maxResults = 20, opts) {
    const fields = ["summary", "status", "issuetype", "priority", "updated", "labels"];
    if (opts?.includeDescription)
        fields.push("description");
    const res = await jiraFetch(config, "/rest/api/3/search/jql", {
        method: "POST",
        body: JSON.stringify({
            jql,
            maxResults,
            fields,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Jira search ${res.status}: ${body}`);
    }
    const data = (await res.json());
    const issues = data.values ?? data.issues ?? [];
    return issues.map((i) => ({
        key: i.key,
        summary: i.fields?.summary ?? "",
        status: i.fields?.status?.name ?? "Unknown",
        type: i.fields?.issuetype?.name ?? "Unknown",
        priority: i.fields?.priority?.name,
        updated: i.fields?.updated,
        description: i.fields?.description,
        labels: i.fields?.labels,
    }));
}
/** Get full issue including description */
async function getIssue(config, issueKey) {
    const res = await jiraFetch(config, `/rest/api/3/issue/${issueKey}?fields=summary,status,issuetype,description`);
    if (!res.ok)
        return null;
    const data = (await res.json());
    return {
        key: data.key,
        summary: data.fields?.summary ?? "",
        status: data.fields?.status?.name ?? "Unknown",
        type: data.fields?.issuetype?.name ?? "Unknown",
        description: data.fields?.description,
    };
}
/** Append arch footer to issue description (for Retag). Jira API v3 uses ADF. */
function descriptionToAdf(text) {
    const lines = text.split("\n").filter(Boolean);
    return {
        type: "doc",
        version: 1,
        content: lines.map((line) => ({
            type: "paragraph",
            content: [{ type: "text", text: line }],
        })),
    };
}
/** Update Jira issue description (Retag = set new fingerprint footer) */
async function updateIssueDescription(config, issueKey, newDescription) {
    try {
        const res = await jiraFetch(config, `/rest/api/3/issue/${issueKey}`, {
            method: "PUT",
            body: JSON.stringify({
                fields: { description: descriptionToAdf(newDescription) },
            }),
        });
        if (!res.ok) {
            const body = await res.text();
            return { success: false, error: `Jira API ${res.status}: ${body}` };
        }
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
/** Add a label to a Jira issue (appends; does not replace existing labels) */
async function addLabel(config, issueKey, label) {
    try {
        const res = await jiraFetch(config, `/rest/api/3/issue/${issueKey}?fields=labels`);
        if (!res.ok) {
            const body = await res.text();
            return { success: false, error: `Jira get issue ${res.status}: ${body}` };
        }
        const data = (await res.json());
        const current = data.fields?.labels ?? [];
        if (current.includes(label))
            return { success: true };
        const labels = [...current, label];
        const putRes = await jiraFetch(config, `/rest/api/3/issue/${issueKey}`, {
            method: "PUT",
            body: JSON.stringify({ fields: { labels } }),
        });
        if (!putRes.ok) {
            const body = await putRes.text();
            return { success: false, error: `Jira add label ${putRes.status}: ${body}` };
        }
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
/** Transition issue to Done/resolved (Archive) */
async function transitionIssue(config, issueKey, transitionId) {
    try {
        const transRes = await jiraFetch(config, `/rest/api/3/issue/${issueKey}/transitions`);
        if (!transRes.ok)
            return { success: false, error: `Failed to fetch transitions` };
        const transData = (await transRes.json());
        const tid = transitionId ?? transData.transitions?.find((t) => /done|resolve|close/i.test(t.name))?.id;
        if (!tid)
            return { success: false, error: "No Done/Resolve transition found" };
        const res = await jiraFetch(config, `/rest/api/3/issue/${issueKey}/transitions`, {
            method: "POST",
            body: JSON.stringify({ transition: { id: tid } }),
        });
        if (!res.ok) {
            const body = await res.text();
            return { success: false, error: `Jira API ${res.status}: ${body}` };
        }
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
