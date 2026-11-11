import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["benchmarks/**/*.bench.ts"], testTimeout: 30_000, silent: false, reporters: ["verbose"] },
});
