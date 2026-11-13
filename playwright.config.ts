import { defineConfig } from "@playwright/test";

// 처음부터 끝까지 확인: 에뮬레이터(인증·데이터베이스)와 화면을 띄우고 로그인부터 홈까지 돈다.
//   npm run test:e2e
const proxy = process.env["GARDEN_E2E_PROXY"];

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "off",
    // 글꼴(구글 폰트)을 받을 때만 프록시를 쓴다. 로컬 주소는 그대로.
    ...(proxy ? { proxy: { server: proxy, bypass: "127.0.0.1,localhost" }, ignoreHTTPSErrors: true } : {}),
  },
  projects: [
    { name: "pc", use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
