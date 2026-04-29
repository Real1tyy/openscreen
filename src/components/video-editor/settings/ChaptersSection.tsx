import { BookMarked, Clock, Copy, Play, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEditorSelectionStore } from "@/stores/useEditorSelectionStore";
import { useEditorStore } from "@/stores/useEditorStore";
import { formatMsCompact } from "@/utils/timeUtils";
import { computeEffectiveMs, formatChaptersForExport } from "../exportUtils";

interface ChaptersSectionProps {
	videoDurationMs: number;
	currentTimeMs?: number;
	onSeek?: (time: number) => void;
	onAddChapter?: () => void;
}

export function ChaptersSection({ currentTimeMs = 0, onSeek, onAddChapter }: ChaptersSectionProps) {
	const chapters = useEditorStore((s) => s.chapters);
	const trimRegions = useEditorStore((s) => s.trimRegions);
	const speedRegions = useEditorStore((s) => s.speedRegions);
	const renameChapter = useEditorStore((s) => s.renameChapter);
	const deleteChapter = useEditorStore((s) => s.deleteChapter);
	const setChapterSpan = useEditorStore((s) => s.setChapterSpan);

	const selectedChapterId = useEditorSelectionStore((s) => s.selectedChapterId);
	const editingChapterId = useEditorSelectionStore((s) => s.editingChapterId);
	const selectChapter = useEditorSelectionStore((s) => s.selectChapter);
	const setEditingChapterId = useEditorSelectionStore((s) => s.setEditingChapterId);

	const sorted = [...chapters].sort((a, b) => a.startMs - b.startMs);

	const handleCopyForYouTube = useCallback(() => {
		const text = formatChaptersForExport(chapters, trimRegions, speedRegions);
		navigator.clipboard.writeText(text);
		toast.success("Chapters copied for YouTube");
	}, [chapters, trimRegions, speedRegions]);

	const handleSetStartToNow = useCallback(
		(id: string) => {
			const ch = chapters.find((c) => c.id === id);
			if (!ch || currentTimeMs >= ch.endMs) return;
			setChapterSpan(id, { start: currentTimeMs, end: ch.endMs });
		},
		[chapters, currentTimeMs, setChapterSpan],
	);

	const handleSetEndToNow = useCallback(
		(id: string) => {
			const ch = chapters.find((c) => c.id === id);
			if (!ch || currentTimeMs <= ch.startMs) return;
			setChapterSpan(id, { start: ch.startMs, end: currentTimeMs });
		},
		[chapters, currentTimeMs, setChapterSpan],
	);

	return (
		<AccordionItem value="chapters" className="border-white/5">
			<AccordionTrigger className="hover:no-underline py-2.5 px-1">
				<div className="flex items-center gap-2">
					<BookMarked className="w-4 h-4 text-purple-400" />
					<span className="text-sm font-medium text-slate-200">Chapters</span>
					{sorted.length > 0 && (
						<span className="text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded-full">
							{sorted.length}
						</span>
					)}
				</div>
			</AccordionTrigger>
			<AccordionContent className="pb-2">
				<div className="space-y-1">
					{sorted.length === 0 && (
						<p className="text-[11px] text-slate-500 text-center py-2">
							No chapters yet. Press C to add one.
						</p>
					)}
					{sorted.map((ch, idx) => (
						<ChapterItem
							key={ch.id}
							name={ch.name}
							startMs={ch.startMs}
							endMs={ch.endMs}
							adjustedStartMs={computeEffectiveMs(ch.startMs, trimRegions, speedRegions)}
							adjustedEndMs={computeEffectiveMs(ch.endMs, trimRegions, speedRegions)}
							index={idx}
							isSelected={ch.id === selectedChapterId}
							isEditing={ch.id === editingChapterId}
							isCurrent={currentTimeMs >= ch.startMs && currentTimeMs < ch.endMs}
							onSelect={() => selectChapter(ch.id)}
							onSeek={() => onSeek?.(ch.startMs / 1000)}
							onRename={(name) => {
								renameChapter(ch.id, name);
								setEditingChapterId(null);
							}}
							onStartEdit={() => setEditingChapterId(ch.id)}
							onCancelEdit={() => setEditingChapterId(null)}
							onDelete={() => deleteChapter(ch.id)}
							onSetStartToNow={() => handleSetStartToNow(ch.id)}
							onSetEndToNow={() => handleSetEndToNow(ch.id)}
						/>
					))}
				</div>

				<div className="flex gap-1.5 mt-2">
					<Button
						onClick={onAddChapter}
						variant="ghost"
						size="sm"
						className="flex-1 h-7 text-[11px] text-slate-400 hover:text-purple-400 hover:bg-purple-400/10 gap-1"
					>
						<Plus className="w-3 h-3" />
						Add Chapter
					</Button>
					{sorted.length > 0 && (
						<Button
							onClick={handleCopyForYouTube}
							variant="ghost"
							size="sm"
							className="flex-1 h-7 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/10 gap-1"
						>
							<Copy className="w-3 h-3" />
							Copy for YouTube
						</Button>
					)}
				</div>
			</AccordionContent>
		</AccordionItem>
	);
}

function ChapterItem({
	name,
	startMs,
	endMs,
	adjustedStartMs,
	adjustedEndMs,
	index,
	isSelected,
	isEditing,
	isCurrent,
	onSelect,
	onSeek,
	onRename,
	onStartEdit,
	onCancelEdit,
	onDelete,
	onSetStartToNow,
	onSetEndToNow,
}: {
	name: string;
	startMs: number;
	endMs: number;
	adjustedStartMs: number;
	adjustedEndMs: number;
	index: number;
	isSelected: boolean;
	isEditing: boolean;
	isCurrent: boolean;
	onSelect: () => void;
	onSeek: () => void;
	onRename: (name: string) => void;
	onStartEdit: () => void;
	onCancelEdit: () => void;
	onDelete: () => void;
	onSetStartToNow: () => void;
	onSetEndToNow: () => void;
}) {
	const [draft, setDraft] = useState(name);
	const inputRef = useRef<HTMLInputElement>(null);
	const [showCtx, setShowCtx] = useState(false);
	const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });

	useEffect(() => {
		if (isEditing) {
			setDraft(name || `Chapter ${index + 1}`);
			setTimeout(() => {
				inputRef.current?.focus();
				inputRef.current?.select();
			}, 0);
		}
	}, [isEditing, name, index]);

	useEffect(() => {
		if (!showCtx) return;
		const close = () => setShowCtx(false);
		window.addEventListener("click", close);
		return () => window.removeEventListener("click", close);
	}, [showCtx]);

	const commitRename = () => {
		const trimmed = draft.trim();
		onRename(trimmed || `Chapter ${index + 1}`);
	};

	return (
		<div
			className={cn(
				"group relative flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all",
				isSelected
					? "bg-purple-500/10 border border-purple-500/20"
					: "hover:bg-white/5 border border-transparent",
				isCurrent && !isSelected && "bg-white/5",
			)}
			onClick={() => {
				onSelect();
				onSeek();
			}}
			onContextMenu={(e) => {
				e.preventDefault();
				onSelect();
				setCtxPos({ x: e.clientX, y: e.clientY });
				setShowCtx(true);
			}}
			onDoubleClick={(e) => {
				e.stopPropagation();
				onStartEdit();
			}}
		>
			<div className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center bg-purple-500/20 text-purple-400 text-[10px] font-bold">
				{index + 1}
			</div>

			<div className="flex-1 min-w-0">
				{isEditing ? (
					<input
						ref={inputRef}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onBlur={commitRename}
						onKeyDown={(e) => {
							if (e.key === "Enter") commitRename();
							if (e.key === "Escape") onCancelEdit();
						}}
						className="w-full bg-transparent text-[12px] text-slate-200 outline-none border-b border-purple-500/50 pb-0.5"
						onClick={(e) => e.stopPropagation()}
					/>
				) : (
					<div className="text-[12px] text-slate-200 truncate">
						{name || `Chapter ${index + 1}`}
					</div>
				)}
				<div className="text-[10px] text-slate-500 tabular-nums">
					{formatMsCompact(adjustedStartMs)} — {formatMsCompact(adjustedEndMs)}
					{(adjustedStartMs !== startMs || adjustedEndMs !== endMs) && (
						<span className="text-slate-600 ml-1">({formatMsCompact(startMs)})</span>
					)}
				</div>
			</div>

			{isCurrent && (
				<div className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0 animate-pulse" />
			)}

			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onSeek();
				}}
				className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-all"
			>
				<Play className="w-3 h-3" />
			</button>

			{showCtx && (
				<>
					<div className="fixed inset-0 z-[100]" onClick={() => setShowCtx(false)} />
					<div
						className="fixed z-[101] bg-[#1a1a1f] border border-white/10 rounded-lg shadow-xl py-1 min-w-[160px]"
						style={{ left: ctxPos.x, top: ctxPos.y }}
					>
						<CtxItem onClick={onStartEdit}>Rename</CtxItem>
						<CtxItem onClick={onSetStartToNow}>
							<Clock className="w-3 h-3" /> Set start to now
						</CtxItem>
						<CtxItem onClick={onSetEndToNow}>
							<Clock className="w-3 h-3" /> Set end to now
						</CtxItem>
						<CtxItem onClick={onSeek}>
							<Play className="w-3 h-3" /> Play from start
						</CtxItem>
						<div className="my-1 h-px bg-white/5" />
						<CtxItem onClick={onDelete} destructive>
							<Trash2 className="w-3 h-3" /> Delete
						</CtxItem>
					</div>
				</>
			)}
		</div>
	);
}

function CtxItem({
	onClick,
	children,
	destructive,
}: {
	onClick: () => void;
	children: React.ReactNode;
	destructive?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
			className={cn(
				"w-full px-3 py-1.5 text-left text-[11px] flex items-center gap-2 transition-colors",
				destructive ? "text-red-400 hover:bg-red-500/10" : "text-slate-300 hover:bg-white/10",
			)}
		>
			{children}
		</button>
	);
}
