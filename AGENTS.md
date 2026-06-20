# Facturín — Agent Guide

Facturín turns a photo of a Mexican purchase receipt into a CFDI invoice automatically. Built for Platanus Hack 26 (Legacy track). This file governs how AI agents work in this repo. Read it fully before touching code.

## Golden rules

- **JavaScript only. NO TypeScript.** No `.ts`/`.tsx`, no type annotations, no `tsconfig`.
- **Package manager: yarn.** Never `npm` or `pnpm`.
- **Node 22.** Run `nvm use 22` before installing or building (the repo pins it via `.nvmrc` + `engines`). The machine's default node is older and will fail.
- **All code and comments in English** — even though the team chats in Spanish.
- **Verify with `yarn build` before opening a PR.** ESLint is intentionally ignored during builds (`next.config.mjs`); a lint nit must never block a deploy.
- **Stay in scope.** Do only what the issue's *Scope* section says. Respect *Out of scope*, and respect *Depends on* — do not start an issue whose dependencies are not yet merged.

## Stack

- **Next.js 16**, App Router, **no `src/` dir**, import alias `@/*`, Tailwind.
- **MongoDB + mongoose 9.** Two DB clients on purpose: mongoose for app queries (`libs/core/mongoose.js`) and a raw `MongoClient` promise (`libs/core/mongo.js`) for the NextAuth adapter. Both read `MONGODB_URI`. Guard every model with `mongoose.models.X || mongoose.model(...)`.
- **Auth: NextAuth v5** (`next-auth@beta`) + `@auth/mongodb-adapter`. The route handler exports `GET/POST` from `handlers` (NOT the v4 default export).
- **Storage: Cloudflare R2** (S3-compatible) via `@aws-sdk/client-s3` + presigned URLs. Clients upload directly to R2 (never proxy files through Next).
- **Ticket OCR:** Google Cloud Vision (`images:annotate` REST, API key) extracts raw text → Anthropic Claude **Haiku** (`claude-haiku-4-5`) parses text into structured JSON.
- **CSF parsing** is deterministic (pdf2json + regex), NOT vision/LLM.

## Env

Copy `.env.example` → `.env.local`. **Never commit secrets.** Real values are needed at runtime (auth / R2 / Vision), but `yarn build` works without them.

## Git / PRs

- One issue → one branch (use the suggested branch name) → one PR.
- Do not touch files unrelated to the issue.
- Commit messages in English. **Do NOT add `Co-Authored-By` or any AI-credit lines.**
