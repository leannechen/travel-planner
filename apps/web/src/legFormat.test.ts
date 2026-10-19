import { describe, expect, it } from "vitest";
import { translate } from "./i18n";
import { formatDistance, formatDuration } from "./legFormat";

const en = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("en", key, params);
const zh = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("zh", key, params);

describe("formatDuration", () => {
  it("writes minutes, whole hours and hours with minutes", () => {
    expect(formatDuration(20, en)).toBe("20 min");
    expect(formatDuration(60, en)).toBe("1 h");
    expect(formatDuration(65, en)).toBe("1 h 5 min");
    expect(formatDuration(65, zh)).toBe("1 小時 5 分");
  });
});

describe("formatDistance", () => {
  it("uses metres below a kilometre and kilometres above", () => {
    expect(formatDistance(650, en)).toBe("650 m");
    expect(formatDistance(7400, en)).toBe("7.4 km");
    expect(formatDistance(12000, en)).toBe("12 km");
    expect(formatDistance(7400, zh)).toBe("7.4 公里");
  });
});
