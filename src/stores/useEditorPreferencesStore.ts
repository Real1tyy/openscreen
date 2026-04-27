import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	DEFAULT_PREFS,
	UserPreferencesSchema,
	type UserPreferences,
} from "@/lib/userPreferences";

interface EditorPreferencesState extends UserPreferences {
	update: (partial: Partial<UserPreferences>) => void;
}

export const useEditorPreferencesStore = create<EditorPreferencesState>()(
	persist(
		(set) => ({
			...DEFAULT_PREFS,

			update: (partial) => set((state) => ({ ...state, ...partial })),
		}),
		{
			name: "openscreen_user_preferences",
			merge: (persisted, current) => {
				const parsed = UserPreferencesSchema.safeParse(persisted);
				return {
					...current,
					...(parsed.success ? parsed.data : DEFAULT_PREFS),
				};
			},
		},
	),
);
