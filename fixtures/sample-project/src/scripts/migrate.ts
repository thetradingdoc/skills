import { request } from "#lib/http";

export function runMigration() {
  return request("POST", "/migrate");
}
