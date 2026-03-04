import { getSession } from "@/auth";
import { createClient } from "@/api/client";

export function App() {
  const session = getSession();
  const client = createClient();
  return { session, client };
}
