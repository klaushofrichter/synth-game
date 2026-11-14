import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sdk = (f: string) => fileURLToPath(new URL(`./.games-service/packages/sdk/src/${f}`, import.meta.url));

export default defineConfig({
  // The same mapping the table host makes for `@game-table/sdk` (games-service D-097), and the paths a table serves the
  // board kit and a game's files at (for the board and phone tests).
  resolve: {
    alias: [
      { find: /^@game-table\/sdk\/cards$/, replacement: sdk("cards.ts") },
      { find: /^@game-table\/sdk$/, replacement: sdk("index.ts") },
      { find: /^\/shared\/board-kit\.js$/, replacement: fileURLToPath(new URL("./.games-service/apps/table-host/public/shared/board-kit.js", import.meta.url)) },
      { find: /^\/games\/(.*)$/, replacement: fileURLToPath(new URL("./games/", import.meta.url)) + "$1" },
    ],
  },
  server: { fs: { allow: ["."] } },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
