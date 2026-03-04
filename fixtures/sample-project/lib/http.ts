export function request(method: string, url: string): Promise<unknown> {
  return Promise.resolve({ method, url });
}
