// TODO: spec v2.0 §14 — detect technology stack of the host project and write
// .claude/config/stack/{backend,frontend}.json so agents can choose appropriate
// conventions automatically.
//
// Detection signals (illustrative):
//   - package.json → React / Vue / Next / Vite / etc.
//   - tsconfig.json → TypeScript
//   - Cargo.toml / go.mod / pyproject.toml → backend language
//   - jest/vitest/pytest config → test runner

export {};
