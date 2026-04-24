import type { Span } from "dnd-timeline";
import type React from "react";
import type { EditorState } from "@/hooks/useEditorHistory";

type StateUpdater = (update: Partial<EditorState> | ((prev: EditorState) => Partial<EditorState>)) => void;

export function deriveNextIdFromList(prefix: string, existingIds: string[]): number {
	return existingIds.reduce((max, id) => {
		const n = Number.parseInt(id.replace(`${prefix}-`, ""), 10);
		return Number.isNaN(n) ? max : Math.max(max, n);
	}, 0) + 1;
}

export function resetIdRef(ref: React.MutableRefObject<number>, prefix: string, existingIds: string[]) {
	ref.current = deriveNextIdFromList(prefix, existingIds);
}

export function createSpanChangeHandler<K extends keyof EditorState>(
	pushState: StateUpdater,
	regionKey: K,
) {
	return (id: string, span: Span) => {
		pushState((prev) => ({
			[regionKey]: (prev[regionKey] as Array<{ id: string; startMs: number; endMs: number }>).map(
				(region) =>
					region.id === id
						? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
						: region,
			),
		}));
	};
}

export function createDeleteHandler<K extends keyof EditorState>(
	pushState: StateUpdater,
	regionKey: K,
	selectedId: string | null,
	clearSelection: () => void,
) {
	return (id: string) => {
		pushState((prev) => ({
			[regionKey]: (prev[regionKey] as Array<{ id: string }>).filter((r) => r.id !== id),
		}));
		if (selectedId === id) clearSelection();
	};
}
