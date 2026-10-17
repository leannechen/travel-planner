import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { healthResponseSchema } from "@travel-planner/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("GET /api/health", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createApp().listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("returns the shared health payload", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(await res.json())).toEqual({ status: "ok" });
  });
});
