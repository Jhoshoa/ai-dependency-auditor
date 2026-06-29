import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const rootDir = resolve(__dirname);

export default defineConfig({
  resolve: {
    extensions: [".ts", ".mts", ".js", ".mjs", ".json"],
  },
  test: {
    root: rootDir,
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    server: {
      fs: {
        allow: [rootDir],
      },
      deps: {
        interopDefault: true,
      },
    },
  },
});
