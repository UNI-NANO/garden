// 화면 진입점. 아직 화면은 없다. (첫 화면 단계에서 채운다)
import { selectEnv } from "./data/env";

const app = document.getElementById("app");
try {
  const env = selectEnv(import.meta.env.VITE_GARDEN_ENV, { isTest: import.meta.env.MODE === "test" });
  if (app && env.name !== "prod") app.textContent = `저편의 정원 — 준비 중 (${env.name})`;
} catch (error) {
  // 화면은 멈추지 않는다. 오류 기록은 GM 패널 단계에서 붙인다.
  if (app) app.textContent = "설정을 읽지 못했어요. 잠시 뒤 다시 열어 주세요.";
  console.error(error);
}
