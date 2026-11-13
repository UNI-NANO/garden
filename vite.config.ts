import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages는 하위 경로(/garden/)에서 열리므로 상대 경로로 묶는다.
  base: "./",
  plugins: [preact()],
  test: {
    include: ["tests/**/*.test.ts"],
    // 에뮬레이터가 필요한 테스트는 `npm run test:emulator`로 따로 돈다.
    exclude: ["tests/emulator/**", "tests/e2e/**", "node_modules/**"],
  },
});
