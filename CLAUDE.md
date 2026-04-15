# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup (install deps, generate Prisma client, run migrations)
npm run setup

# Development server (with Turbopack)
npm run dev

# Build
npm run build

# Lint
npm run lint

# Run all tests
npm test

# Run a single test file
npx vitest run src/components/chat/__tests__/ChatInterface.test.tsx

# Reset the database
npm run db:reset

# Regenerate Prisma client after schema changes
npx prisma generate && npx prisma migrate dev
```

## Architecture

UIGen is a Next.js 15 App Router app that lets users describe React components in a chat interface and see them rendered live.

### Request Flow

1. User types a prompt → `ChatInterface` sends messages + current VFS state to `POST /api/chat`
2. The API route calls Claude (or `MockLanguageModel` if no API key) via Vercel AI SDK's `streamText`
3. Claude calls two tools: `str_replace_editor` (create/edit files) and `file_manager` (rename/delete)
4. The AI SDK streams tool call events back to the client
5. `ChatContext` processes incoming tool calls via `FileSystemContext.handleToolCall`
6. `FileSystemContext` mutates the in-memory `VirtualFileSystem` and increments `refreshTrigger`
7. `PreviewFrame` reacts to `refreshTrigger`, rebuilds the import map, and sets `iframe.srcdoc`

### Virtual File System

All generated files live in a **`VirtualFileSystem`** instance in memory — nothing is written to disk. `VirtualFileSystem` (`src/lib/file-system.ts`) is a tree of `FileNode` objects backed by a `Map<string, FileNode>`. It serializes/deserializes to plain `Record<string, FileNode>` for API transport and Prisma storage.

`FileSystemContext` (`src/lib/contexts/file-system-context.tsx`) wraps this class for React, exposing mutation helpers and a `refreshTrigger` counter that triggers preview re-renders.

### Live Preview Pipeline

`PreviewFrame` (`src/components/preview/PreviewFrame.tsx`) drives the preview:
- Calls `createImportMap()` from `src/lib/transform/jsx-transformer.ts`
- That function transpiles each JSX/TSX file with `@babel/standalone`, creates blob URLs, and builds an ES module import map
- Third-party packages are resolved via `https://esm.sh/`; `@/` aliases are mapped to root `/`
- The generated HTML document (`createPreviewHTML`) is injected into a sandboxed `<iframe>` via `srcdoc`
- Tailwind CSS is loaded from CDN inside the iframe

### AI Provider

`src/lib/provider.ts` exports `getLanguageModel()`:
- If `ANTHROPIC_API_KEY` is set → uses `claude-haiku-4-5` via `@ai-sdk/anthropic`
- If not → falls back to `MockLanguageModel`, a fully local implementation of `LanguageModelV1` that returns static components without any network calls

### Auth & Persistence

- Auth uses **JWT stored in an httpOnly cookie** (7-day expiry). `src/lib/auth.ts` handles session creation/verification; `src/middleware.ts` protects `/api/projects` and `/api/filesystem`.
- Data is stored in **SQLite via Prisma** (`prisma/dev.db`). The Prisma client is generated into `src/generated/prisma/`.
- Anonymous users' work is held in `sessionStorage` via `src/lib/anon-work-tracker.ts` so it can be migrated to a project on sign-up.
- Authenticated users' projects (messages + VFS snapshot) are saved to the `Project` model at the end of each chat response in `onFinish`.

### Key Contexts

| Context | File | Purpose |
|---|---|---|
| `FileSystemContext` | `src/lib/contexts/file-system-context.tsx` | VFS state + tool call dispatch |
| `ChatContext` | `src/lib/contexts/chat-context.tsx` | Vercel AI SDK `useChat` hook + tool call forwarding |

### `node-compat.cjs`

The dev/build scripts prefix `NODE_OPTIONS='--require ./node-compat.cjs'`. This shim patches Node.js globals needed by Prisma/bcrypt when running under Next.js with Turbopack.
