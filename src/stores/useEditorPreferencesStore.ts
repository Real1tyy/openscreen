import { create } from "zustand";
import {
	DEFAULT_PREFS,
	loadUserPreferences,
	saveUserPreferences,
	type UserPreferences,
} from "@/lib/userPreferences";

interface EditorPreferencesState extends UserPreferences {
	hydrated: boolean;
	hydrate: () => void;
	update: (partial: Partial<UserPreferences>) => void;
}

export const useEditorPreferencesStore = create<EditorPreferencesState>()((set) => ({
	...DEFAULT_PREFS,
	hydrated: false,

	hydrate: () => {
		const prefs = loadUserPreferences();
		set({ ...prefs, hydrated: true });
	},

	update: (partial) =>
		set((state) => {
			const next = { ...state, ...partial };
			saveUserPreferences(next);
			return next;
		}),
}));
