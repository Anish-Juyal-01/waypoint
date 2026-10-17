import { describe, expect, it } from "vitest";
import { bindingFromEvent, codeToVk, formatBinding } from "./hotkeys";

const ev = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe("hotkeys", () => {
  it("maps physical keys to virtual-key codes", () => {
    expect(codeToVk("KeyM")).toBe(0x4d);
    expect(codeToVk("Digit3")).toBe(0x33);
    expect(codeToVk("F9")).toBe(0x78);
    expect(codeToVk("ArrowRight")).toBe(0x27);
    expect(codeToVk("Unknown")).toBeNull();
  });

  it("builds a binding with RegisterHotKey modifier flags", () => {
    expect(bindingFromEvent(ev("F9", { ctrlKey: true, altKey: true }))).toEqual({ modifiers: 3, key: 0x78 });
  });

  it("requires Ctrl or Alt, except Shift + function key", () => {
    expect(bindingFromEvent(ev("KeyM"))).toHaveProperty("error");
    expect(bindingFromEvent(ev("KeyM", { shiftKey: true }))).toHaveProperty("error");
    expect(bindingFromEvent(ev("F8", { shiftKey: true }))).toEqual({ modifiers: 4, key: 0x77 });
  });

  it("ignores modifier-only presses", () => {
    expect(bindingFromEvent(ev("ControlLeft", { ctrlKey: true }))).toBeNull();
  });

  it("formats bindings for display", () => {
    expect(formatBinding({ modifiers: 3, key: 0x78 })).toBe("Ctrl + Alt + F9");
    expect(formatBinding(null)).toBe("Not set");
  });
});
