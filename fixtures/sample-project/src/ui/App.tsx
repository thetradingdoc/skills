import { getSession } from "../auth/index";
import { createClient } from "../api/client";

export function App() {
  const session = getSession();
  const client = createClient();
  return { session, client };
}

export function Dashboard() {
  return { title: "Dashboard" };
}
