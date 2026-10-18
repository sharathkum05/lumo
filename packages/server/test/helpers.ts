import type { AddressInfo } from "node:net";
import { after } from "node:test";
import { createApp, openDatabase, LumoService } from "../src/index.ts";

/** Starts a Lumo server on a random port with one user ("ana") and project ("WEB"). */
export async function startServer() {
  const svc = new LumoService(openDatabase(":memory:"));
  const ana = svc.createUser({ username: "ana", displayName: "Ana Silva", email: "ana@example.com" });
  svc.createUser({ username: "raj", displayName: "Raj Patel", email: "raj@example.com" });
  const token = svc.createApiToken(ana.id, "test");
  svc.createProject({ key: "WEB", name: "Website", lead: "ana" });

  const server = createApp(svc);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  }

  return { svc, base, token, call };
}
