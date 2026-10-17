import { describe, expect, it } from "vitest";
import { insertAt, isReorderOf, moveBy, removeId } from "./day-order";

describe("insertAt", () => {
  it("inserts at a 1-based position and shifts later items", () => {
    expect(insertAt(["a", "b", "c"], "x", 2)).toEqual(["a", "x", "b", "c"]);
  });

  it("inserts at the start and at the end", () => {
    expect(insertAt(["a", "b"], "x", 1)).toEqual(["x", "a", "b"]);
    expect(insertAt(["a", "b"], "x", 3)).toEqual(["a", "b", "x"]);
  });

  it("rejects a position outside 1..length+1", () => {
    expect(() => insertAt(["a"], "x", 0)).toThrow(RangeError);
    expect(() => insertAt(["a"], "x", 3)).toThrow(RangeError);
  });

  it("does not mutate the input", () => {
    const input = ["a"];
    insertAt(input, "x", 1);
    expect(input).toEqual(["a"]);
  });
});

describe("removeId", () => {
  it("removes the item and closes the gap", () => {
    expect(removeId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("returns the list unchanged when the id is absent", () => {
    expect(removeId(["a"], "z")).toEqual(["a"]);
  });
});

describe("moveBy", () => {
  it("moves an item earlier", () => {
    expect(moveBy(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
  });

  it("moves an item later", () => {
    expect(moveBy(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("leaves the list as is at either end", () => {
    expect(moveBy(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveBy(["a", "b"], "b", 1)).toEqual(["a", "b"]);
  });

  it("leaves the list as is for an unknown id", () => {
    expect(moveBy(["a", "b"], "z", 1)).toEqual(["a", "b"]);
  });
});

describe("isReorderOf", () => {
  it("accepts any permutation of the same ids", () => {
    expect(isReorderOf(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("rejects missing, extra and duplicated ids", () => {
    expect(isReorderOf(["a", "b"], ["a"])).toBe(false);
    expect(isReorderOf(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(isReorderOf(["a", "b"], ["a", "a"])).toBe(false);
  });
});
