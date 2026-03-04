import { request } from "#lib/http";

export function createClient() {
  return {
    connect: () => request("GET", "/connect"),
  };
}
