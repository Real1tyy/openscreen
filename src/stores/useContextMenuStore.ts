import { create } from "zustand";

export type RegionType = "zoom" | "trim" | "speed" | "annotation";

interface ContextMenuState {
	regionType: RegionType | null;
	regionId: string | null;
	x: number;
	y: number;
	open: (type: RegionType, id: string, x: number, y: number) => void;
	close: () => void;
}

export const useContextMenuStore = create<ContextMenuState>()((set) => ({
	regionType: null,
	regionId: null,
	x: 0,
	y: 0,

	open: (regionType, regionId, x, y) => set({ regionType, regionId, x, y }),
	close: () => set({ regionType: null, regionId: null }),
}));
