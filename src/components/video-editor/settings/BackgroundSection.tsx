import Block from "@uiw/react-color-block";
import { Palette, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useScopedT } from "@/contexts/I18nContext";
import { getAssetPath } from "@/lib/assetPath";
import { handleImageFileUpload } from "@/lib/imageHandling";
import { cn } from "@/lib/utils";

const WALLPAPER_COUNT = 18;
const WALLPAPER_RELATIVE = Array.from(
	{ length: WALLPAPER_COUNT },
	(_, i) => `wallpapers/wallpaper${i + 1}.jpg`,
);

const GRADIENTS = [
	"linear-gradient( 111.6deg,  rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(253,129,82,1) 54.8%, rgba(249,202,86,1) 86.3% )",
	"linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
	"radial-gradient( circle farthest-corner at 3.2% 49.6%,  rgba(80,12,139,0.87) 0%, rgba(161,10,144,0.72) 83.6% )",
	"linear-gradient( 111.6deg,  rgba(0,56,68,1) 0%, rgba(163,217,185,1) 51.5%, rgba(231, 148, 6, 1) 88.6% )",
	"linear-gradient( 107.7deg,  rgba(235,230,44,0.55) 8.4%, rgba(252,152,15,1) 90.3% )",
	"linear-gradient( 91deg,  rgba(72,154,78,1) 5.2%, rgba(251,206,70,1) 95.9% )",
	"radial-gradient( circle farthest-corner at 10% 20%,  rgba(2,37,78,1) 0%, rgba(4,56,126,1) 19.7%, rgba(85,245,221,1) 100.2% )",
	"linear-gradient( 109.6deg,  rgba(15,2,2,1) 11.2%, rgba(36,163,190,1) 91.1% )",
	"linear-gradient(135deg, #FBC8B4, #2447B1)",
	"linear-gradient(109.6deg, #F635A6, #36D860)",
	"linear-gradient(90deg, #FF0101, #4DFF01)",
	"linear-gradient(315deg, #EC0101, #5044A9)",
	"linear-gradient(45deg, #ff9a9e 0%, #fad0c4 99%, #fad0c4 100%)",
	"linear-gradient(to top, #a18cd1 0%, #fbc2eb 100%)",
	"linear-gradient(to right, #ff8177 0%, #ff867a 0%, #ff8c7f 21%, #f99185 52%, #cf556c 78%, #b12a5b 100%)",
	"linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)",
	"linear-gradient(to right, #4facfe 0%, #00f2fe 100%)",
	"linear-gradient(to top, #fcc5e4 0%, #fda34b 15%, #ff7882 35%, #c8699e 52%, #7046aa 71%, #0c1db8 87%, #020f75 100%)",
	"linear-gradient(to right, #fa709a 0%, #fee140 100%)",
	"linear-gradient(to top, #30cfd0 0%, #330867 100%)",
	"linear-gradient(to top, #c471f5 0%, #fa71cd 100%)",
	"linear-gradient(to right, #f78ca0 0%, #f9748f 19%, #fd868c 60%, #fe9a8b 100%)",
	"linear-gradient(to top, #48c6ef 0%, #6f86d6 100%)",
	"linear-gradient(to right, #0acffe 0%, #495aff 100%)",
];

const COLOR_PALETTE = [
	"#000000", "#1a1a2e", "#16213e", "#0f3460", "#533483",
	"#e94560", "#f8b400", "#faf0e6", "#ffffff", "#2d3436",
	"#636e72", "#dfe6e9", "#6c5ce7", "#a29bfe", "#fd79a8",
	"#fab1a0", "#00b894", "#00cec9", "#0984e3", "#74b9ff",
];

const CUSTOM_IMAGES_KEY = "openscreen-custom-wallpapers";

interface BackgroundSectionProps {
	selected: string;
	onWallpaperChange: (path: string) => void;
}

export function BackgroundSection({ selected, onWallpaperChange }: BackgroundSectionProps) {
	const t = useScopedT("settings");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [wallpaperPaths, setWallpaperPaths] = useState<string[]>([]);
	const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);
	const [gradient, setGradient] = useState(GRADIENTS[0]);
	const [customImages, setCustomImages] = useState<string[]>(() => {
		try {
			return JSON.parse(localStorage.getItem(CUSTOM_IMAGES_KEY) || "[]");
		} catch {
			return [];
		}
	});

	useEffect(() => {
		let cancelled = false;
		async function loadPaths() {
			const resolved = await Promise.all(
				WALLPAPER_RELATIVE.map((rel) => getAssetPath(rel)),
			);
			if (!cancelled) setWallpaperPaths(resolved);
		}
		loadPaths();
		return () => { cancelled = true; };
	}, []);

	const handleImageUpload = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			handleImageFileUpload(e, {
				onInvalidType: () => toast.error(t("background.invalidFileType")),
				onSuccess: (dataUrl) => {
					setCustomImages((prev) => {
						const next = [dataUrl, ...prev];
						localStorage.setItem(CUSTOM_IMAGES_KEY, JSON.stringify(next));
						return next;
					});
					onWallpaperChange(dataUrl);
				},
			});
		},
		[onWallpaperChange, t],
	);

	const handleRemoveCustomImage = useCallback(
		(imageUrl: string, e: React.MouseEvent) => {
			e.stopPropagation();
			setCustomImages((prev) => {
				const next = prev.filter((img) => img !== imageUrl);
				localStorage.setItem(CUSTOM_IMAGES_KEY, JSON.stringify(next));
				return next;
			});
			if (selected === imageUrl) {
				const fallback = wallpaperPaths[0] || `/${WALLPAPER_RELATIVE[0]}`;
				onWallpaperChange(fallback);
			}
		},
		[selected, wallpaperPaths, onWallpaperChange],
	);

	return (
		<AccordionItem value="background" className="border-white/5 rounded-xl bg-white/[0.02] px-3">
			<AccordionTrigger className="py-2.5 hover:no-underline">
				<div className="flex items-center gap-2">
					<Palette className="w-4 h-4 text-[#34B27B]" />
					<span className="text-xs font-medium">{t("background.title")}</span>
				</div>
			</AccordionTrigger>
			<AccordionContent className="pb-3">
				<Tabs defaultValue="image" className="w-full">
					<TabsList className="mb-2 bg-white/5 border border-white/5 p-0.5 w-full grid grid-cols-3 h-7 rounded-lg">
						<TabsTrigger value="image" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 text-[10px] py-1 rounded-md transition-all">
							{t("background.image")}
						</TabsTrigger>
						<TabsTrigger value="color" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 text-[10px] py-1 rounded-md transition-all">
							{t("background.color")}
						</TabsTrigger>
						<TabsTrigger value="gradient" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 text-[10px] py-1 rounded-md transition-all">
							{t("background.gradient")}
						</TabsTrigger>
					</TabsList>

					<div className="max-h-[min(200px,25vh)] overflow-y-auto custom-scrollbar">
						<TabsContent value="image" className="mt-0 space-y-2">
							<input type="file" ref={fileInputRef} onChange={handleImageUpload} accept=".jpg,.jpeg,image/jpeg" className="hidden" />
							<Button
								onClick={() => fileInputRef.current?.click()}
								variant="outline"
								className="w-full gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-[#34B27B] hover:text-white hover:border-[#34B27B] transition-all h-7 text-[10px]"
							>
								<Upload className="w-3 h-3" />
								{t("background.uploadCustom")}
							</Button>

							<div className="grid grid-cols-7 gap-1.5">
								{customImages.map((imageUrl, idx) => (
									<WallpaperTile
										key={`custom-${idx}`}
										path={imageUrl}
										isSelected={selected === imageUrl}
										onClick={() => onWallpaperChange(imageUrl)}
										onRemove={(e) => handleRemoveCustomImage(imageUrl, e)}
									/>
								))}
								{(wallpaperPaths.length > 0 ? wallpaperPaths : WALLPAPER_RELATIVE.map((p) => `/${p}`)).map((path) => {
									const isSelected = isWallpaperSelected(selected, path);
									return (
										<WallpaperTile key={path} path={path} isSelected={isSelected} onClick={() => onWallpaperChange(path)} />
									);
								})}
							</div>
						</TabsContent>

						<TabsContent value="color" className="mt-0">
							<div className="p-1">
								<Block
									color={selectedColor}
									colors={COLOR_PALETTE}
									onChange={(color) => {
										setSelectedColor(color.hex);
										onWallpaperChange(color.hex);
									}}
									style={{ width: "100%", borderRadius: "8px" }}
								/>
							</div>
						</TabsContent>

						<TabsContent value="gradient" className="mt-0">
							<div className="grid grid-cols-7 gap-1.5">
								{GRADIENTS.map((g, idx) => (
									<div
										key={g}
										className={cn(
											"aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 shadow-sm",
											gradient === g
												? "border-[#34B27B] ring-1 ring-[#34B27B]/30"
												: "border-white/10 hover:border-[#34B27B]/40 opacity-80 hover:opacity-100 bg-white/5",
										)}
										style={{ background: g }}
										aria-label={t("background.gradientLabel", { index: idx + 1 })}
										onClick={() => { setGradient(g); onWallpaperChange(g); }}
										role="button"
									/>
								))}
							</div>
						</TabsContent>
					</div>
				</Tabs>
			</AccordionContent>
		</AccordionItem>
	);
}

function WallpaperTile({
	path,
	isSelected,
	onClick,
	onRemove,
}: {
	path: string;
	isSelected: boolean;
	onClick: () => void;
	onRemove?: (e: React.MouseEvent) => void;
}) {
	return (
		<div
			className={cn(
				"aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 relative group shadow-sm",
				isSelected
					? "border-[#34B27B] ring-1 ring-[#34B27B]/30"
					: "border-white/10 hover:border-[#34B27B]/40 opacity-80 hover:opacity-100 bg-white/5",
			)}
			style={{ backgroundImage: `url(${path})`, backgroundSize: "cover", backgroundPosition: "center" }}
			onClick={onClick}
			role="button"
		>
			{onRemove && (
				<button
					onClick={onRemove}
					className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
				>
					<X className="w-2 h-2 text-white" />
				</button>
			)}
		</div>
	);
}

function isWallpaperSelected(selected: string, path: string): boolean {
	if (!selected) return false;
	if (selected === path) return true;
	try {
		const clean = (s: string) => s.replace(/^file:\/\//, "").replace(/^\//, "");
		if (clean(selected).endsWith(clean(path))) return true;
		if (clean(path).endsWith(clean(selected))) return true;
	} catch {
		// fallback to strict match
	}
	return false;
}
