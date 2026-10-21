import { describe, expect, it } from "vitest";
import { healthResponseSchema, maskEmail } from "./index";

describe("healthResponseSchema", () => {
  it("accepts the health payload", () => {
    expect(healthResponseSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
  });

  it("rejects anything else", () => {
    expect(healthResponseSchema.safeParse({ status: "down" }).success).toBe(false);
  });
});

describe("maskEmail", () => {
  it("hides the middle of the name and keeps the domain", () => {
    expect(maskEmail("leannechen.tw+2@gmail.com")).toBe("l******2@gmail.com");
    expect(maskEmail("mei@example.com")).toBe("m*i@example.com");
    expect(maskEmail("ab@example.com")).toBe("**@example.com");
  });
});
