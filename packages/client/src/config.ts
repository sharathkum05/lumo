import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { JiraBackend } from "./jira-backend.ts";
import { LumoBackend } from "./lumo-backend.ts";
import type { TrackerClient } from "./types.ts";

export interface ConnectionConfig {
  backend: "lumo" | "jira";
  url: string;
  token: string;
  /** Required for Jira Cloud, which authenticates with email + API token. */
  email?: string;
}

interface ConfigFile {
  default?: string;
  profiles?: Record<string, Partial<ConnectionConfig>>;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.LUMO_CONFIG ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "lumo", "config.json");
}

/**
 * Resolves connection settings. Environment variables (LUMO_URL, LUMO_TOKEN, LUMO_BACKEND, LUMO_EMAIL)
 * override the selected profile from the config file.
 */
export function loadConfig(opts: { profile?: string; env?: NodeJS.ProcessEnv } = {}): ConnectionConfig {
  const env = opts.env ?? process.env;
  let file: ConfigFile = {};
  try {
    file = JSON.parse(readFileSync(configPath(env), "utf8")) as ConfigFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Could not read ${configPath(env)}: ${(err as Error).message}`);
    }
  }
  const name = opts.profile ?? env.LUMO_PROFILE ?? file.default ?? "default";
  const profile = file.profiles?.[name] ?? {};
  if (opts.profile && !file.profiles?.[name]) throw new Error(`Profile "${name}" is not in ${configPath(env)}`);

  const config = {
    backend: (env.LUMO_BACKEND ?? profile.backend ?? "lumo") as ConnectionConfig["backend"],
    url: env.LUMO_URL ?? profile.url ?? "",
    token: env.LUMO_TOKEN ?? profile.token ?? "",
    email: env.LUMO_EMAIL ?? profile.email,
  };
  if (config.backend !== "lumo" && config.backend !== "jira") {
    throw new Error(`Backend must be "lumo" or "jira", got "${config.backend}"`);
  }
  const missing = [!config.url && "url (LUMO_URL)", !config.token && "token (LUMO_TOKEN)", config.backend === "jira" && !config.email && "email (LUMO_EMAIL)"].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}. Set environment variables or add a profile to ${configPath(env)}`);
  }
  return config;
}

export function createClient(config: ConnectionConfig, fetchImpl?: typeof fetch): TrackerClient {
  if (config.backend === "jira") {
    return new JiraBackend({ baseUrl: config.url, email: config.email ?? "", token: config.token, fetch: fetchImpl });
  }
  return new LumoBackend({ baseUrl: config.url, token: config.token, fetch: fetchImpl });
}
