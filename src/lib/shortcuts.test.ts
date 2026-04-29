// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	bindingsEqual,
	DEFAULT_SHORTCUTS,
	findConflict,
	formatBinding,
	matchesShortcut,
	mergeWithDefaults,
	type ShortcutBinding,
} from "./shortcuts";

describe("bindingsEqual", () => {
	it("matches identical bindings", () => {
		expect(bindingsEqual({ key: "z", ctrl: true }, { key: "z", ctrl: true })).toBe(true);
	});

	it("is case-insensitive on key", () => {
		expect(bindingsEqual({ key: "Z" }, { key: "z" })).toBe(true);
	});

	it("treats undefined modifiers as false", () => {
		expect(bindingsEqual({ key: "a" }, { key: "a", ctrl: false, shift: false, alt: false })).toBe(
			true,
		);
	});

	it("returns false for different keys", () => {
		expect(bindingsEqual({ key: "a" }, { key: "b" })).toBe(false);
	});

	it("returns false when ctrl differs", () => {
		expect(bindingsEqual({ key: "a", ctrl: true }, { key: "a" })).toBe(false);
	});

	it("returns false when shift differs", () => {
		expect(bindingsEqual({ key: "a", shift: true }, { key: "a" })).toBe(false);
	});

	it("returns false when alt differs", () => {
		expect(bindingsEqual({ key: "a", alt: true }, { key: "a" })).toBe(false);
	});
});

describe("findConflict", () => {
	it("returns null when no conflict", () => {
		expect(findConflict({ key: "q" }, "addZoom", DEFAULT_SHORTCUTS)).toBeNull();
	});

	it("detects conflict with another configurable shortcut", () => {
		const result = findConflict({ key: "t" }, "addZoom", DEFAULT_SHORTCUTS);
		expect(result).toEqual({ type: "configurable", action: "addTrim" });
	});

	it("does not conflict with itself", () => {
		expect(findConflict({ key: "z" }, "addZoom", DEFAULT_SHORTCUTS)).toBeNull();
	});

	it("detects conflict with fixed shortcuts", () => {
		const result = findConflict({ key: "z", ctrl: true }, "addZoom", DEFAULT_SHORTCUTS);
		expect(result).toEqual({ type: "fixed", label: "Undo" });
	});

	it("detects Redo conflict (Ctrl+Shift+Z)", () => {
		const result = findConflict(
			{ key: "z", ctrl: true, shift: true },
			"addZoom",
			DEFAULT_SHORTCUTS,
		);
		expect(result).toEqual({ type: "fixed", label: "Redo" });
	});
});

describe("matchesShortcut", () => {
	function makeEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
		return {
			key: "a",
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			altKey: false,
			...overrides,
		} as KeyboardEvent;
	}

	it("matches simple key press", () => {
		const e = makeEvent({ key: "a" });
		expect(matchesShortcut(e, { key: "a" }, false)).toBe(true);
	});

	it("is case-insensitive", () => {
		const e = makeEvent({ key: "A" });
		expect(matchesShortcut(e, { key: "a" }, false)).toBe(true);
	});

	it("uses ctrlKey on non-Mac", () => {
		const e = makeEvent({ key: "z", ctrlKey: true });
		expect(matchesShortcut(e, { key: "z", ctrl: true }, false)).toBe(true);
	});

	it("uses metaKey on Mac", () => {
		const e = makeEvent({ key: "z", metaKey: true });
		expect(matchesShortcut(e, { key: "z", ctrl: true }, true)).toBe(true);
	});

	it("rejects when ctrl binding expected but not pressed (non-Mac)", () => {
		const e = makeEvent({ key: "z" });
		expect(matchesShortcut(e, { key: "z", ctrl: true }, false)).toBe(false);
	});

	it("rejects extra shift modifier", () => {
		const e = makeEvent({ key: "a", shiftKey: true });
		expect(matchesShortcut(e, { key: "a" }, false)).toBe(false);
	});

	it("rejects extra alt modifier", () => {
		const e = makeEvent({ key: "a", altKey: true });
		expect(matchesShortcut(e, { key: "a" }, false)).toBe(false);
	});

	it("matches full combo: Ctrl+Shift+A on non-Mac", () => {
		const e = makeEvent({ key: "a", ctrlKey: true, shiftKey: true });
		expect(matchesShortcut(e, { key: "a", ctrl: true, shift: true }, false)).toBe(true);
	});
});

describe("formatBinding", () => {
	it("formats simple key", () => {
		expect(formatBinding({ key: "a" }, false)).toBe("A");
	});

	it("formats Ctrl on non-Mac", () => {
		expect(formatBinding({ key: "z", ctrl: true }, false)).toBe("Ctrl + Z");
	});

	it("formats Cmd on Mac", () => {
		expect(formatBinding({ key: "z", ctrl: true }, true)).toBe("⌘ + Z");
	});

	it("formats Shift", () => {
		expect(formatBinding({ key: "z", ctrl: true, shift: true }, false)).toBe("Ctrl + Shift + Z");
	});

	it("formats Alt on non-Mac", () => {
		expect(formatBinding({ key: "a", alt: true }, false)).toBe("Alt + A");
	});

	it("formats Option on Mac", () => {
		expect(formatBinding({ key: "a", alt: true }, true)).toBe("⌥ + A");
	});

	it("formats special key labels (Space)", () => {
		expect(formatBinding({ key: " " }, false)).toBe("Space");
	});

	it("formats special key labels (arrows)", () => {
		expect(formatBinding({ key: "arrowleft" }, false)).toBe("←");
		expect(formatBinding({ key: "arrowright" }, false)).toBe("→");
	});

	it("formats all modifiers on Mac", () => {
		expect(formatBinding({ key: "a", ctrl: true, shift: true, alt: true }, true)).toBe(
			"⌘ + ⇧ + ⌥ + A",
		);
	});
});

describe("mergeWithDefaults", () => {
	it("returns defaults when given empty partial", () => {
		expect(mergeWithDefaults({})).toEqual(DEFAULT_SHORTCUTS);
	});

	it("overrides specified actions", () => {
		const result = mergeWithDefaults({ addZoom: { key: "q" } });
		expect(result.addZoom).toEqual({ key: "q" });
		expect(result.addTrim).toEqual(DEFAULT_SHORTCUTS.addTrim);
	});

	it("preserves all default actions when not overridden", () => {
		const result = mergeWithDefaults({ playPause: { key: "p" } });
		expect(result.addZoom).toEqual(DEFAULT_SHORTCUTS.addZoom);
		expect(result.addTrim).toEqual(DEFAULT_SHORTCUTS.addTrim);
		expect(result.addSpeed).toEqual(DEFAULT_SHORTCUTS.addSpeed);
		expect(result.addAnnotation).toEqual(DEFAULT_SHORTCUTS.addAnnotation);
		expect(result.deleteSelected).toEqual(DEFAULT_SHORTCUTS.deleteSelected);
		expect(result.playPause).toEqual({ key: "p" });
	});
});
