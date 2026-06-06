import { defineConfig } from "vitest/config";

// The source uses NodeNext `.js` import specifiers that resolve to `.ts` files;
// extensionAlias lets Vite/Vitest follow them without a build step.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    extensionAlias: { ".js": [".ts", ".js"] },
  },
});
