import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unitaires",
          include: ["tests/unitaires/**/*.test.ts"],
        },
      },
      {
        test: {
          // Contre une vraie base PostgreSQL de test (voir tests/integration/preparation-base.ts)
          name: "integration",
          include: ["tests/integration/**/*.test.ts", "tests/securite/**/*.test.ts"],
          globalSetup: ["tests/integration/preparation-base.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
