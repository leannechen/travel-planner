import { describe, expect, it } from "vitest";
import { backupFileName } from "./backupFile";

describe("backupFileName", () => {
  it("joins the words of the title and ends with -backup.json", () => {
    expect(backupFileName("Kyoto & Osaka")).toBe("Kyoto-&-Osaka-backup.json");
    expect(backupFileName("  Spring  2027 ")).toBe("Spring-2027-backup.json");
  });
  it("leaves out what a file name cannot hold, and keeps other scripts", () => {
    expect(backupFileName('a/b\\c:d*e?"f<g>h|i')).toBe("a-b-c-d-e-f-g-h-i-backup.json");
    expect(backupFileName("京都 五日遊")).toBe("京都-五日遊-backup.json");
  });
  it("never starts with a dot and falls back to trip", () => {
    expect(backupFileName("..hidden")).toBe("hidden-backup.json");
    expect(backupFileName("///")).toBe("trip-backup.json");
  });
});
