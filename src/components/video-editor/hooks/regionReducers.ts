import type { Span } from "dnd-timeline";
import type { EditorState } from "@/hooks/useEditorHistory";

type StateUpdater = (update: Partial<EditorState> | ((prev: EditorState) => Partial<EditorState>)) => void;

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
