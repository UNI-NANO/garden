import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/** 화면 캡처를 둘 곳. 저장소에는 넣지 않는다 */
const shots = process.env["GARDEN_SHOTS"] ?? join(import.meta.dirname, "..", "..", "test-results", "shots");
mkdirSync(shots, { recursive: true });

/** 판정 바가 가운데(완벽 칸)에 닿는 시간: 한 번 지나가는 1200ms의 절반 */
const CENTER_MS = 600;
/** 45% 자리: 좋음 칸(숙련도 30이면 40.2~59.8) 안, 완벽 칸(47.6~52.4) 밖 */
const GOOD_MS = 540;

async function enter(page: Page, name: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "도서관 입구" })).toBeVisible();
  await page.getByLabel("시험 계정 이름").fill(name);
  await page.getByRole("button", { name: "시험 계정으로 들어가기" }).click();
  await expect(page.getByRole("heading", { name: "세계수 도서관" })).toBeVisible();
}

/** 시계를 멈춘다. 그 뒤로는 runFor로 흘린 만큼만 판정 바가 움직인다 */
async function pauseClock(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

/** 판정 바를 가운데에서 친다 (시계가 멈춰 있어야 한다) */
async function hitCenter(page: Page) {
  const bar = page.getByRole("dialog", { name: "판정 바" });
  await expect(bar).toBeVisible();
  await page.clock.runFor(CENTER_MS);
  await page.keyboard.press("Space");
}

test("연습 전투: 편성을 고르고, 판정 바로 쳐서 늑대를 이긴다", async ({ page }, info) => {
  const shot = (name: string) => page.screenshot({ path: join(shots, `battle-${name}-${info.project.name}.png`), fullPage: true });
  await page.clock.install();
  await enter(page, "연습하는 사람");

  await page.getByRole("button", { name: "연습 전투 (시험 환경)" }).click();
  await expect(page.getByRole("heading", { name: "연습 전투" })).toBeVisible();
  // 기본 편성: 연속 베기 · 검풍 · 되받아치기, 늑대 하나, 혼자
  await expect(page.getByText("기본기 3개 (3/3)")).toBeVisible();
  await shot("1-setup");
  await page.getByRole("button", { name: "싸우기" }).click();

  await expect(page.getByText("제1턴 · 아군 차례")).toBeVisible();
  await pauseClock(page);
  await expect(page.getByRole("region", { name: "적의 의도" })).toContainText("→ 나");
  await shot("2-field");

  // 기술을 고르면 칠 수 있는 적만 고를 수 있다
  const wolf = page.getByRole("button", { name: "늑대 고르기" });
  await expect(wolf).toHaveCount(0);
  await page.getByRole("button", { name: /^기본 공격.*베기/ }).click();
  await expect(wolf).toBeEnabled();
  await wolf.click();
  await expect(page.getByRole("dialog", { name: "판정 바" })).toBeVisible();
  await page.clock.runFor(GOOD_MS);
  await shot("3-judge");
  await page.keyboard.press("Space");
  // 판정 결과로 한 턴이 돌고, 피해가 기록된다: 베기 6 × 1.09 × 1.5(자상 약함) = 9.8 → 10
  await expect(page.getByText("제2턴 · 아군 차례")).toBeVisible();
  await expect(page.getByRole("region", { name: "이번 턴" })).toContainText("나 → 늑대 10늑대 → 나 7");
  // 가운데를 치면 완벽: × 1.3 = 12.8 → 13
  await page.getByRole("button", { name: /^기본 공격.*베기/ }).click();
  await page.getByRole("button", { name: "늑대 고르기" }).click();
  await hitCenter(page);
  await expect(page.getByRole("region", { name: "이번 턴" })).toContainText("나 → 늑대 13 (완벽)");

  // 이길 때까지 베기로 친다
  for (let turn = 0; turn < 10; turn++) {
    if (await page.getByRole("region", { name: "전투 결과" }).isVisible()) break;
    await page.getByRole("button", { name: /^기본 공격.*베기/ }).click();
    await page.getByRole("button", { name: "늑대 고르기" }).click();
    await hitCenter(page);
  }
  const result = page.getByRole("region", { name: "전투 결과" });
  await expect(result).toContainText("승리");
  await shot("4-result");

  // 다시 하면 새 전투, 돌아가기로 편성 화면
  await result.getByRole("button", { name: "다시" }).click();
  await expect(page.getByText("제1턴 · 아군 차례")).toBeVisible();
  await page.getByRole("button", { name: "그만두기" }).click();
  await expect(page.getByRole("heading", { name: "연습 전투" })).toBeVisible();
  await page.getByRole("button", { name: "돌아가기" }).click();
  await expect(page.getByRole("heading", { name: "세계수 도서관" })).toBeVisible();
});

test("연습 전투: 끝까지 누르지 않으면 빗나간다", async ({ page }) => {
  await page.clock.install();
  await enter(page, "느린 사람");
  await page.getByRole("button", { name: "연습 전투 (시험 환경)" }).click();
  await page.getByRole("button", { name: "싸우기" }).click();
  await expect(page.getByText("제1턴 · 아군 차례")).toBeVisible();
  await pauseClock(page);
  await page.getByRole("button", { name: /^기본 공격.*베기/ }).click();
  await page.getByRole("button", { name: "늑대 고르기" }).click();
  await expect(page.getByRole("dialog", { name: "판정 바" })).toBeVisible();
  // 끝(1200ms) 바로 앞까지는 아직 판정하지 않는다
  await page.clock.runFor(1100);
  await expect(page.getByRole("dialog", { name: "판정 바" })).toBeVisible();
  await page.clock.runFor(400);
  await expect(page.getByText("제2턴 · 아군 차례")).toBeVisible();
  await expect(page.getByRole("region", { name: "이번 턴" })).toContainText("나 → 늑대 0 (빗나감)");
});
