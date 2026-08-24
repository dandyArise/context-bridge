# Testing strategy

Vitest unit tests cover pure parsing, budgets, safe-cut invariants, edit invalidation, structural
tool capping, and SSE framing. TypeScript strict mode checks SDK contracts. ESLint and Prettier are
quality gates. The build plus `lms dev --install -y` validates packaging and plugin registration.
Real provider quality/capabilities remain endpoint-specific; use `pnpm run discover` before a chat.
