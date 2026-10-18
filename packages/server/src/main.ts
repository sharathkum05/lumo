import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { LumoService } from "./service.ts";

const dbPath = process.env.LUMO_DB ?? "lumo.db";
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "127.0.0.1";

const svc = new LumoService(openDatabase(dbPath));

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

createApp(svc).listen(port, host, () => {
  console.log(`Lumo listening on http://${host}:${port} (database: ${dbPath})`);
});
