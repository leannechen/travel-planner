import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { fakeTokenVerifier } from "./auth";
import { createDb } from "./db/client";
import { TEST_DATABASE_URL } from "../test/global-setup";

describe("serving the web app", () => {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  const dir = mkdtempSync(path.join(tmpdir(), "web-"));
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Travel Planner</title>");
    writeFileSync(path.join(dir, "logo.svg"), "<svg/>");
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");
    const app = createApp(db, { auth: fakeTokenVerifier(), webDir: dir });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers the page at the root and at the web app's own paths, checked again on every load", async () => {
    for (const at of ["/", "/trip/0b5d9a6e-1c1f-4a59-9a43-6f9c9d4f1b2a?view=map", "/t/some-secret", "/?invite=abc"]) {
      const res = await fetch(`${baseUrl}${at}`);
      expect(res.status, at).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(await res.text()).toContain("<title>Travel Planner</title>");
    }
  });

  it("keeps hashed assets for a year and other files only until changed", async () => {
    const asset = await fetch(`${baseUrl}/assets/index-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const logo = await fetch(`${baseUrl}/logo.svg`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("cache-control")).toBe("no-cache");
  });

  it("answers 404 for a missing file instead of the page", async () => {
    for (const at of ["/assets/MarkdownEditor-oldhash.js", "/missing.png"]) {
      const res = await fetch(`${baseUrl}${at}`);
      expect(res.status, at).toBe(404);
      expect(res.headers.get("content-type") ?? "", at).not.toMatch(/text\/html/);
    }
  });

  it("forbids other sites to frame the page and the browser to guess file types", async () => {
    for (const at of ["/", "/trip/x", "/assets/index-abc123.js"]) {
      const res = await fetch(`${baseUrl}${at}`);
      expect(res.headers.get("x-frame-options"), at).toBe("DENY");
      expect(res.headers.get("content-security-policy"), at).toBe("frame-ancestors 'none'");
      expect(res.headers.get("x-content-type-options"), at).toBe("nosniff");
      expect(res.headers.get("x-powered-by"), at).toBeNull();
    }
  });

  it("leaves /api to the API", async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    expect(await health.json()).toEqual({ status: "ok" });
    const unknown = await fetch(`${baseUrl}/api/no-such-route`, { headers: { authorization: "Bearer fake:someone" } });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).not.toContain("<title>Travel Planner</title>");
    const post = await fetch(`${baseUrl}/trip/x`, { method: "POST" });
    expect(post.status).toBe(404);
  });
});
