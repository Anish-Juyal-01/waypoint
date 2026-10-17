import { describe, expect, it } from "vitest";
import { mergeVisibleOrder, move } from "./order";

describe("mergeVisibleOrder", () => {
  it("returns the new order when everything is visible", () => {
    expect(mergeVisibleOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("keeps hidden devices in their absolute slots", () => {
    // b and d are hidden (disconnected); user moved c above a.
    expect(mergeVisibleOrder(["a", "b", "c", "d", "e"], ["c", "a", "e"])).toEqual(["c", "b", "a", "d", "e"]);
  });

  it("is a no-op when the visible order is unchanged", () => {
    expect(mergeVisibleOrder(["a", "x", "b"], ["a", "b"])).toEqual(["a", "x", "b"]);
  });
});

describe("move", () => {
  it("moves an item without mutating the input", () => {
    const input = [1, 2, 3, 4];
    expect(move(input, 3, 0)).toEqual([4, 1, 2, 3]);
    expect(input).toEqual([1, 2, 3, 4]);
  });
});
