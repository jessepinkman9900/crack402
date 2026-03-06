import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/unit/**/*.test.ts"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
