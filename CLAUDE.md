# OpenScreen

Desktop video editor built with React 18, TypeScript, Vite, Tauri 2 (primary) and Electron (legacy).

## Tech Stack

- **UI**: React 18 + Radix UI + Tailwind CSS 3
- **State**: Zustand (with Immer + Zundo temporal middleware for undo/redo)
- **Validation**: Zod
- **Canvas/Video**: PixiJS 8, WebCodecs, mp4box, mediabunny
- **Animations**: GSAP + Motion (Framer Motion)
- **Timeline**: dnd-timeline
- **Linting/Formatting**: Biome (single tool for both)
- **Testing**: Vitest + @testing-library/react + Playwright (E2E)
- **Package Manager**: pnpm
- **Tooling**: mise (task runner, git hooks, tool versions)

## Commands

```bash
mise run dev              # Start Vite dev server
mise run dev-tauri        # Start Tauri dev mode
mise run test             # Run unit tests
mise run test-e2e         # Run Playwright E2E tests
mise run typecheck        # TypeScript check
mise run lint             # Lint changed files (auto-fix)
mise run lint-all         # Lint entire project (auto-fix)
mise run format           # Format changed files
mise run changed          # Format + lint changed files
mise run ci               # Full CI: lint + typecheck + tests (no writes)
mise run setup-hooks      # Install git pre-commit hook
mise run dev-info         # Show tool versions
```

## Pre-commit Hook

Uses `mise generate git-pre-commit` — no husky. The hook runs `mise run pre-commit` which:
1. Runs `pnpm lint-staged` (biome check --write --unsafe on staged files)
2. Runs `tsc --noEmit`

If the hook is missing, run `mise run setup-hooks` to reinstall it.

**Important for agents**: Before committing, run `./node_modules/.bin/biome check --write --unsafe <files>` on any files you modify. The `pnpm biome` alias may not work due to rtk hook interference — always use the `./node_modules/.bin/biome` path directly.

## Project Structure

```
src/
├── components/video-editor/    # Main editor (VideoEditor.tsx is the root)
│   ├── hooks/                  # Handler hooks (zoom, trim, speed, annotation, chapter)
│   ├── timeline/               # dnd-timeline integration
│   ├── settings/               # Settings panel sections
│   ├── videoPlayback/          # PixiJS preview rendering
│   └── types.ts                # Region types, zoom scales
├── stores/                     # Zustand stores
├── lib/
│   ├── exporter/               # WebCodecs export pipeline (MP4, GIF, NVENC)
│   ├── shortcuts.ts            # Keyboard shortcut config
│   ├── userPreferences.ts      # User preference persistence
│   └── tauriBridge.ts          # Tauri/Electron abstraction layer
├── contexts/                   # I18n, Shortcuts contexts
├── hooks/                      # Global hooks (useEditorHistory, useSelection)
├── i18n/locales/               # en, es, fr, tr, zh-CN
└── components/ui/              # Radix UI primitives
```

## Conventions

- Biome handles both formatting (tabs, double quotes, LF) and linting
- Import sorting is enforced by biome's `organizeImports` assist
- `useExhaustiveDependencies` is set to warn — fix all warnings before committing
- i18n uses a custom lightweight loader with dot-notation keys and `{{ var }}` interpolation
- The export pipeline is highly specialized — avoid introducing generic media libraries
