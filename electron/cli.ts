import path from "node:path";
import { Command, InvalidArgumentError } from "commander";

export interface CliOptions {
	inputFile: string | null;
	export: boolean;
	output: string | null;
	blur: boolean;
	shadow: boolean;
	shadowIntensity: number;
	motionBlur: number;
	roundness: number;
	padding: number;
	background: string;
	resolution: { width: number; height: number } | null;
	bitrate: number | null;
	fps: number;
}

// --- Custom parsers ---

function parseFloat01(value: string): number {
	const n = Number.parseFloat(value);
	if (!Number.isFinite(n) || n < 0 || n > 1) throw new InvalidArgumentError("Must be 0.0–1.0");
	return n;
}

function parsePercent(value: string): number {
	const n = Number.parseFloat(value);
	if (!Number.isFinite(n) || n < 0 || n > 100) throw new InvalidArgumentError("Must be 0–100");
	return n;
}

function parsePositiveFloat(value: string): number {
	const n = Number.parseFloat(value);
	if (!Number.isFinite(n) || n < 0) throw new InvalidArgumentError("Must be non-negative");
	return n;
}

function parsePositiveInt(value: string): number {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError("Must be a positive integer");
	return n;
}

function parseFps(value: string): number {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 1 || n > 120) throw new InvalidArgumentError("Must be 1–120");
	return n;
}

const RESOLUTION_PRESETS: Record<string, { width: number; height: number }> = {
	"720p": { width: 1280, height: 720 },
	"1080p": { width: 1920, height: 1080 },
	"1440p": { width: 2560, height: 1440 },
	"4k": { width: 3840, height: 2160 },
};

function parseResolution(value: string): { width: number; height: number } {
	const preset = RESOLUTION_PRESETS[value.toLowerCase()];
	if (preset) return preset;

	const match = value.match(/^(\d+)x(\d+)$/i);
	if (match) {
		const w = Number.parseInt(match[1], 10);
		const h = Number.parseInt(match[2], 10);
		if (w > 0 && h > 0) {
			return { width: Math.floor(w / 2) * 2, height: Math.floor(h / 2) * 2 };
		}
	}

	throw new InvalidArgumentError("Use WxH (e.g. 1920x1080) or preset (720p, 1080p, 1440p, 4k)");
}

// --- Program definition ---

const program = new Command()
	.name("openscreen")
	.description("Screen recorder & video editor with CLI support")
	.version("1.3.0")
	.argument("[file]", "video file to open in the editor")
	.option("--export", "headless export mode (no GUI)", false)
	.option("-o, --output <path>", "output file path")
	.option("--blur", "apply background blur", false)
	.option("--shadow", "apply drop shadow (default intensity: 0.7)", false)
	.option("--shadow-intensity <n>", "shadow intensity", parseFloat01)
	.option("--motion-blur <n>", "motion blur amount 0–100", parsePercent)
	.option("--roundness <n>", "border radius in pixels", parsePositiveFloat)
	.option("--padding <n>", "padding percentage 0–100", parsePercent, 50)
	.option(
		"--background <value>",
		"background: hex color, CSS gradient, or wallpaper path",
		"/wallpapers/wallpaper1.jpg",
	)
	.option("--resolution <WxH>", "export resolution (1920x1080, 1080p, 720p, 4k)", parseResolution)
	.option("--bitrate <n>", "bitrate in bps", parsePositiveInt)
	.option("--fps <n>", "frame rate", parseFps, 60)
	.addHelpText(
		"after",
		`
Examples:
  $ openscreen recording.mp4
  $ openscreen --export recording.mp4 --shadow --blur --roundness 12 --padding 30
  $ openscreen --export input.mp4 -o polished.mp4 --background "#1a1a2e" --shadow`,
	);

export function parseCliArgs(argv: string[]): CliOptions {
	// Commander needs the first two elements to be node binary + script path.
	// In Electron packaged apps argv[0] is the app binary itself, so we
	// prepend a dummy element to keep commander happy.
	const normalizedArgv = argv[0]?.includes("electron") ? argv : ["electron", ".", ...argv.slice(1)];

	program.parse(normalizedArgv);

	const opts = program.opts();
	const fileArg = program.args[0] ?? null;

	// Resolve shadow: --shadow-intensity implies --shadow
	const shadowIntensity = opts.shadowIntensity ?? (opts.shadow ? 0.7 : 0);
	const shadow = shadowIntensity > 0 || opts.shadow;

	const result: CliOptions = {
		inputFile: fileArg ? path.resolve(fileArg) : null,
		export: opts.export,
		output: opts.output ?? null,
		blur: opts.blur,
		shadow,
		shadowIntensity,
		motionBlur: opts.motionBlur ?? 0,
		roundness: opts.roundness ?? 0,
		padding: opts.padding,
		background: opts.background,
		resolution: opts.resolution ?? null,
		bitrate: opts.bitrate ?? null,
		fps: opts.fps,
	};

	// Derive output path if not specified
	if (result.export && result.inputFile && !result.output) {
		const parsed = path.parse(result.inputFile);
		result.output = path.join(parsed.dir, `${parsed.name}-openscreen.mp4`);
	}

	return result;
}
