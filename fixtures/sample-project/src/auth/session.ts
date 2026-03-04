// DRIFT VIOLATION: auth must not depend on api
import { createClient } from "../api/client";

export function initSession() {
  const client = createClient();
  return client.connect();
}
