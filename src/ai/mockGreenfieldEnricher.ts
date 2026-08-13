/**
 * Mock Greenfield enricher — returns well-formed graphCommand for local dev.
 * Use USE_MOCK_GREENFIELD=true to avoid API key requirement.
 */

import type { ArchitectureChatHistory, GraphCommand } from "../types";
import type { GreenfieldAskResult } from "./greenfieldEnricher";

const DEFAULT_GRAPH_COMMANDS: GraphCommand[] = [
  {
    action: "create_node",
    id: "src/api",
    label: "API Layer",
    layer: "Presentation",
    archNodeId: "api",
    description: "HTTP entry point that receives requests and delegates to the auth service.",
  },
  {
    action: "create_node",
    id: "src/services/auth",
    label: "Auth Service",
    layer: "Business Logic",
    description: "Verifies credentials and issues sessions/tokens for authenticated requests.",
  },
  {
    action: "create_node",
    id: "src/repositories/user",
    label: "User Repo",
    layer: "Data Access",
    description: "Reads and writes user records for the auth service.",
  },
  { action: "connect", fromId: "src/api", toId: "src/services/auth", relation: "calls" },
  { action: "connect", fromId: "src/services/auth", toId: "src/repositories/user", relation: "reads" },
];

const DEFAULT_FIXTURE: { answer: string; graphCommands: GraphCommand[] } = {
  answer:
    "Mock design: Here's a typical layered architecture.\n\n- **Presentation:** API layer\n- **Business Logic:** Services\n- **Data Access:** Repositories",
  graphCommands: DEFAULT_GRAPH_COMMANDS,
};

const FRONTEND_GRAPH_COMMANDS: GraphCommand[] = [
  {
    action: "create_node",
    id: "src/ui/pages",
    label: "Pages",
    layer: "Presentation",
    description: "Route-level pages that compose components and read from the app store.",
  },
  {
    action: "create_node",
    id: "src/ui/components",
    label: "Components",
    layer: "Presentation",
    description: "Reusable presentational UI components shared across pages.",
  },
  {
    action: "create_node",
    id: "src/store/app",
    label: "App Store",
    layer: "Business Logic",
    description: "Holds global client state and the actions that mutate it.",
  },
  { action: "connect", fromId: "src/ui/pages", toId: "src/ui/components", relation: "calls" },
  { action: "connect", fromId: "src/ui/pages", toId: "src/store/app", relation: "reads" },
];

function matchDesign(question: string): { answer: string; graphCommands: GraphCommand[] } {
  const q = question.toLowerCase();
  if (/frontend|react|ui\b|website|web app|webapp/.test(q)) {
    return {
      answer:
        "I've designed a frontend architecture:\n\n**Layers:** Pages & Components (Presentation), Store (Business Logic).\n**Modules:** Route pages, shared components, app store.",
      graphCommands: FRONTEND_GRAPH_COMMANDS,
    };
  }
  if (/backend|api gateway|saas backend/.test(q)) {
    return {
      answer:
        "I've designed a modular backend architecture:\n\n**Layers:** API (Presentation), Services (Business Logic), Repo (Data Access).\n**Modules:** API gateway, Auth service, User service.",
      graphCommands: [
        {
          action: "create_node",
          id: "src/api",
          label: "API Gateway",
          layer: "Presentation",
          description: "REST/GraphQL entry point that routes requests to backend services.",
        },
        {
          action: "create_node",
          id: "src/services/auth",
          label: "Auth Service",
          layer: "Business Logic",
          description: "Verifies credentials and issues sessions/tokens for authenticated requests.",
        },
        {
          action: "create_node",
          id: "src/repositories/user",
          label: "User Repo",
          layer: "Data Access",
          description: "Reads and writes user records for the auth service.",
        },
        { action: "connect", fromId: "src/api", toId: "src/services/auth", relation: "calls" },
        { action: "connect", fromId: "src/services/auth", toId: "src/repositories/user", relation: "reads" },
      ],
    };
  }
  return DEFAULT_FIXTURE;
}

export async function askGreenfieldMock(params: {
  question: string;
  history?: ArchitectureChatHistory;
}): Promise<GreenfieldAskResult> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const { question } = params;
  const { answer, graphCommands } = matchDesign(question);
  return { answer, graphCommands };
}
