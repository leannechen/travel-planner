import { describe, expect, it } from "vitest";
import { detectLanguage, translate } from "./i18n";
import { en, zh } from "./messages";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("messages", () => {
  it("has the same keys and placeholders in both languages", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
    }
  });
  it("uses the design's Chinese terms", () => {
    expect(zh["area.backlog"]).toBe("未決區");
    expect(zh["area.archive"]).toBe("放棄區");
    expect(zh["kind.attraction"]).toBe("景點");
    expect(zh["kind.meal"]).toBe("餐廳");
    expect(zh["kind.lodging"]).toBe("住宿");
    expect(zh["kind.transport"]).toBe("交通");
    expect(zh["day.title"]).toBe("第 {n} 天");
    expect(zh["event.description"]).toBe("說明");
    expect(zh["todo.panel"]).toBe("待辦");
    expect(zh["notes.title"]).toBe("筆記");
  });
});

describe("translate", () => {
  it("fills in placeholders", () => {
    expect(translate("en", "day.title", { n: 3 })).toBe("Day 3");
    expect(translate("zh", "day.title", { n: 3 })).toBe("第 3 天");
  });
  it("picks the plural form", () => {
    expect(translate("en", "count.todo", { count: 1 })).toBe("1 Todo");
    expect(translate("en", "count.todo", { count: 2 })).toBe("2 Todos");
    expect(translate("en", "count.todo", { count: 0 })).toBe("0 Todos");
    expect(translate("zh", "count.todo", { count: 1 })).toBe("1 項待辦");
    expect(translate("zh", "count.todo", { count: 5 })).toBe("5 項待辦");
  });
  it("leaves unknown placeholders and keys visible", () => {
    expect(translate("en", "day.title")).toBe("Day {n}");
    expect(translate("en", "no.such.key")).toBe("no.such.key");
  });
});

describe("detectLanguage", () => {
  it("chooses Chinese for any Chinese browser language, else English", () => {
    expect(detectLanguage(["zh-TW", "en"])).toBe("zh");
    expect(detectLanguage(["en-US"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });
});
