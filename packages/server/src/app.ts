import { createServer, type IncomingMessage, type Server } from "node:http";
import type { User } from "@lumo/core";
import { apiV1 } from "./api-v1.ts";
import { jiraV3 } from "./jira-v3.ts";
import { send, type Router } from "./router.ts";
import type { LumoService } from "./service.ts";

/**
 * Accepts `Authorization: Bearer <token>` or, like Jira Cloud, `Basic base64(email:token)`.
 * With Basic auth the username part must belong to the token's owner.
 */
export function authenticateRequest(svc: LumoService, req: IncomingMessage): User | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value = ""] = header.split(" ", 2);
  if (scheme?.toLowerCase() === "bearer") return svc.authenticate(value.trim());
  if (scheme?.toLowerCase() === "basic") {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    const login = decoded.slice(0, sep).toLowerCase();
    const user = svc.authenticate(decoded.slice(sep + 1));
    return user && (user.email.toLowerCase() === login || user.username.toLowerCase() === login) ? user : null;
  }
  return null;
}

export function createApp(svc: LumoService, routers: Router[] = [apiV1(svc), jiraV3(svc)]): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const router = routers.find((r) => r.handles(url.pathname));
    if (!router) {
      send(res, 404, { error: "Not found" });
      return;
    }
    let cached: User | null | undefined;
    const authenticate = () => (cached === undefined ? (cached = authenticateRequest(svc, req)) : cached);
    router.dispatch(req, res, url, authenticate).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: "Internal server error" });
    });
  });
}
