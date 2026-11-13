import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/emulator/**/*.test.ts"],
    // 테스트 파일들이 같은 에뮬레이터 데이터베이스를 쓰므로 한 파일씩 차례로 돈다.
    fileParallelism: false,
  },
});
