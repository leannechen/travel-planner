import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./index";

describe("healthResponseSchema", () => {
  it("accepts the health payload", () => {
    expect(healthResponseSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
  });

  it("rejects anything else", () => {
    expect(healthResponseSchema.safeParse({ status: "down" }).success).toBe(false);
  });
});
