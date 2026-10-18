import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { LumoService } from "./service.ts";

const dbPath = process.env.LUMO_DB ?? "lumo.db";
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "127.0.0.1";

const db = openDatabase(dbPath);
const svc = new LumoService(db);

// First run: create an admin and print a token once. Only its hash is stored.
if (svc.userCount() === 0) {
  const admin = svc.createUser({
    username: process.env.LUMO_ADMIN_USERNAME ?? "admin",
    displayName: "Administrator",
    email: process.env.LUMO_ADMIN_EMAIL ?? "admin@localhost.local",
  });
  const token = svc.createApiToken(admin.id, "bootstrap");
  console.log(`Created user "${admin.username}" (${admin.email}).`);
  console.log(`API token (shown once, save it now): ${token}`);
}

const server = createApp(svc).listen(port, host, () => {
  console.log(`Lumo listening on http://${host}:${port} (database: ${dbPath})`);
});

// Docker and ECS send SIGTERM on stop. Finish in-flight requests, then close SQLite so the WAL is checkpointed.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
