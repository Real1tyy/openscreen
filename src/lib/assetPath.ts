function encodeRelativeAssetPath(relativePath: string): string {
	return relativePath
		.replace(/^\/+/, "")
		.split("/")
		.filter(Boolean)
		.map((part) => encodeURIComponent(part))
		.join("/");
}

export async function getAssetPath(relativePath: string): Promise<string> {
	const encodedRelativePath = encodeRelativeAssetPath(relativePath);

	try {
		if (typeof window !== "undefined") {
			// If running in a dev server (http/https), prefer the web-served path
			if (
				window.location &&
				window.location.protocol &&
				window.location.protocol.startsWith("http")
			) {
				return `/${encodedRelativePath}`;
			}

			// Tauri production: get base path from Rust, then use convertFileSrc
			const { getAPI, isTauri } = await import("@/lib/tauriBridge");
			const api = getAPI();
			if (api && typeof api.getAssetBasePath === "function") {
				const base = await api.getAssetBasePath();
				if (base && isTauri()) {
					const { convertFileSrc } = await import("@tauri-apps/api/core");
					const fullPath = `${base}/${relativePath.replace(/^\/+/, "")}`;
					return convertFileSrc(fullPath);
				}
				if (base) {
					const { URL } = globalThis;
					return new URL(encodedRelativePath, base.endsWith("/") ? base : `${base}/`).toString();
				}
			}
		}
	} catch {
		// ignore and use fallback
	}

	return `/${encodedRelativePath}`;
}

export default getAssetPath;
