# Repository Guidelines

## Project Structure & Module Organization

TextLab Bible is a Next.js App Router app. Route surfaces live in `app/` (`read`, `search`, `assistant`, `notes`, `api`). Reusable UI lives in `components/`, with search-specific pieces under `components/search/`. Shared server and domain logic lives in `lib/`; `lib/search.ts` is a facade over `lib/search/*`, and assistant orchestration is under `lib/ai/`. Prisma schema and handwritten SQL migrations live in `prisma/`. Corpus import, embedding, acceptance, and eval scripts live in `scripts/`. Tests are grouped under `tests/unit/` and `tests/integration/`; docs are mapped from `docs/README.md`.

## Build, Test, and Development Commands

- `npm run dev`: start local Next.js at `http://localhost:3000`.
- `npm run build`: run `prisma generate` and `next build`.
- `npm run lint`: ESLint with `--max-warnings=0`.
- `npx tsc --noEmit --pretty false`: strict TypeScript check.
- `npm run test:unit`: Vitest unit suite.
- `npm run test:coverage`: unit tests plus v8 coverage gate.
- `npm run verify`: lint, typecheck, build, and coverage.
- `npm run test:integration` / `npm run test:acceptance`: DB-backed suites using `.env.test`.
- `npm run eval:gate`: deterministic DB-only eval gate.

## Coding Style & Naming Conventions

Use TypeScript, React 19, and strict mode. Follow the existing two-space indentation, named exports where practical, PascalCase React components, camelCase helpers, and `*.test.ts` / `*.test.tsx` test files. Prefer `@/` imports in app/lib code; scripts may need relative imports when loader aliases are brittle. Keep comments short and reserved for non-obvious behavior.

## Testing Guidelines

Vitest is the primary test runner; Testing Library covers React components. Coverage is scoped to `app/api/**/*.ts` and `lib/**/*.ts` with thresholds in `vitest.config.ts` (80 lines/statements, 75 functions, 65 branches). Integration, acceptance, and eval commands write and delete test data, so point `.env.test` at a throwaway database.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit-style subjects such as `docs: ...` and `fix(search): ...`. Keep commits focused. PRs should describe the user-visible change, list verification commands, call out migrations/env changes, link issues when relevant, and include screenshots for UI changes.

## Security & Configuration Tips

Do not use `db:push`; it is intentionally disabled because FTS/vector behavior depends on handwritten migrations. Use `npm run db:migrate:deploy`. Keep secrets in `.env` or `.env.test`; never point test/eval commands at production data. After major changes, check `README.md`, `docs/PROJECT_STATE.md`, and `docs/security-register.md` for required updates.
