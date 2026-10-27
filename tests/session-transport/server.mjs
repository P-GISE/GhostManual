// Loopback-only TLS fixture: real Next UI and cookie transport, synthetic persistence.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.APP_ORIGIN = "https://127.0.0.1:3443";
process.env.DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic_test";
const { sessionCookie, requestSession, endpoint, json } = await import("../../src/lib/http.ts");
const { freshToken, tokenHash } = await import("../../src/lib/session.ts");
const { GET } = await import("../../src/app/api/session/route.ts");
const { pool } = await import("../../src/lib/db.ts");
const sessions = new Map();
const observations = [];
pool.query = async (_sql, parameters) => ({
  rows: sessions.has(parameters[0]) ? [sessions.get(parameters[0])] : [],
});
const directory = mkdtempSync(join(tmpdir(), "ghost-tls-"));
const key = join(directory, "key.pem"),
  cert = join(directory, "cert.pem");
const generated = spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
if (generated.status !== 0) throw new Error("local_fixture_certificate_failed");
const next = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3322"],
  { env: { ...process.env, AI_ENABLED: "false" }, stdio: "ignore" },
);
async function api(request, scenario) {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/workspaces")
    return endpoint(request, async () => {
      const input = await request.json();
      if (!["blank", "example"].includes(input.mode)) return json({}, 422);
      const token = freshToken(),
        expires = new Date(Date.now() + 86400000);
      sessions.set(tokenHash(token), {
        workspace_id: "11111111-1111-4111-8111-111111111111",
        id: "22222222-2222-4222-8222-222222222222",
        role: "owner",
        expires_at: expires,
        share_id: null,
        manual_id: null,
      });
      const result = json({ expiresAt: expires }, 201);
      if (scenario !== "missing-cookie")
        result.headers.set("Set-Cookie", sessionCookie(token, expires));
      return result;
    });
  if (pathname === "/api/session") {
    if (scenario === "session-timeout") await new Promise((resolve) => setTimeout(resolve, 12000));
    if (scenario === "session-unavailable")
      return json({ error: { message: "synthetic unavailable" } }, 503);
    const result = await GET(request);
    if (result.status === 200 && scenario === "drop-after-session")
      result.headers.set(
        "Set-Cookie",
        "gm_owner=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      );
    return result;
  }
  return endpoint(request, async () => {
    await requestSession(request);
    return json([]);
  });
}
const server = https.createServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, process.env.APP_ORIGIN);
      if (url.pathname === "/__fixture/observations") {
        outgoing.setHeader("Content-Type", "application/json");
        outgoing.end(JSON.stringify(observations));
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const parts = [];
        for await (const part of incoming) parts.push(part);
        const request = new Request(url, {
          method: incoming.method,
          headers: incoming.headers,
          body: ["GET", "HEAD"].includes(incoming.method) ? undefined : Buffer.concat(parts),
        });
        const result = await api(request, incoming.headers["x-fixture-scenario"]);
        observations.push({
          path: url.pathname,
          status: result.status,
          ownerPresent: /(?:^|;\s*)gm_owner=[A-Za-z0-9_-]{43}(?:;|$)/.test(
            incoming.headers.cookie ?? "",
          ),
        });
        outgoing.writeHead(result.status, Object.fromEntries(result.headers));
        outgoing.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      if (url.pathname === "/manuals")
        observations.push({
          path: "/manuals",
          prefetch: incoming.headers["next-router-prefetch"] === "1",
          ownerPresent: Boolean(incoming.headers.cookie?.includes("gm_owner=")),
        });
      const proxy = http.request(
        {
          hostname: "127.0.0.1",
          port: 3322,
          path: incoming.url,
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode, response.headers);
          response.pipe(outgoing);
        },
      );
      proxy.on("error", () => {
        outgoing.writeHead(503);
        outgoing.end();
      });
      incoming.pipe(proxy);
    } catch {
      outgoing.writeHead(500);
      outgoing.end("fixture_failed");
    }
  },
);
server.listen(3443, "127.0.0.1");
function close() {
  next.kill();
  server.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
