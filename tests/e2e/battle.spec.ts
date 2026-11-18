import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/** 화면 캡처를 둘 곳. 저장소에는 넣지 않는다 */
const shots =
  process.env["GARDEN_SHOTS"] ??
  join(import.meta.dirname, "..", "..", "test-results", "shots");
mkdirSync(shots, { recursive: true });

/** 판정 바가 가운데(완벽 칸)에 닿는 시간: 한 번 지나가는 1200ms의 절반 */
const CENTER_MS = 600;
/** 45% 자리: 좋음 칸(숙련도 30이면 40.2~59.8) 안, 완벽 칸(47.6~52.4) 밖 */
const GOOD_MS = 540;

async function enter(page: Page, name: string) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "도서관 입구" }),
  ).toBeVisible();
  await page.getByLabel("시험 계정 이름").fill(name);
  await page.getByRole("button", { name: "시험 계정으로 들어가기" }).click();
  await expect(
    page.getByRole("heading", { name: "세계수 도서관" }),
  ).toBeVisible();
}

/** 시계를 멈춘다. 그 뒤로는 runFor로 흘린 만큼만 판정 바가 움직인다 */
async function pauseClock(page: Page) {
  // 느린 CI에서는 시각을 읽은 뒤 멈추기 전에 그 시각이 지나갈 수 있어, 조금 앞을 노리고 지났으면 다시 한다
  for (let i = 0; ; i++) {
    try {
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 300));
      return;
    } catch (error) {
      if (i >= 4 || !String(error).includes("past")) throw error;
    }
  }
}

/** 판정 바를 가운데(완벽)에서, 또는 at만큼 지나서 친다 (시계가 멈춰 있어야 한다) */
async function hitCenter(page: Page, at = CENTER_MS) {
  const bar = page.getByRole("dialog", { name: "판정 바" });
  await expect(bar).toBeVisible();
  await page.clock.runFor(at);
  await page.keyboard.press("Space");
}

/** 적 차례 반응: 고르고 판정 바 가운데에서 친다 (시계가 멈춰 있어야 한다) */
async function react(page: Page, kind: "막기" | "받아치기" | "피하기") {
  const dialog = page.getByRole("dialog", { name: "반응" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: new RegExp(`^${kind}`) }).click();
  await expect(
    page.getByRole("group", { name: `${kind} 판정 바` }),
  ).toBeVisible();
  await page.clock.runFor(CENTER_MS);
  await page.keyboard.press("Space");
}

/** 연습장에 들어가 기본 편성(늑대 하나, 혼자)으로 시작하고 시계를 멈춘다 */
async function startPractice(page: Page, name: string) {
  await page.clock.install();
  await enter(page, name);
  await page.getByRole("button", { name: "연습 전투 (시험 환경)" }).click();
  await page.getByRole("button", { name: "싸우기" }).click();
  await expect(page.getByText("제1턴 · 아군 차례")).toBeVisible();
  await pauseClock(page);
}

const thisTurn = (page: Page) => page.getByRole("region", { name: "이번 턴" });

/** 적 차례: 반응을 물으면 막기로 받고, 다음 아군 차례까지 기다린다 (적이 흐트러졌으면 묻지 않는다) */
async function settle(page: Page, nextTurn: number) {
  const reaction = page.getByRole("dialog", { name: "반응" });
  const next = page.getByText(`제${nextTurn}턴 · 아군 차례`);
  await expect(reaction.or(next)).toBeVisible();
  if (await reaction.isVisible()) await react(page, "막기");
  await expect(next).toBeVisible();
}

test("연습 전투: 편성을 고르고, 판정 바로 쳐서 늑대를 이긴다", async ({
  page,
}, info) => {
  const shot = (name: string) =>
    page.screenshot({
      path: join(shots, `battle-${name}-${info.project.name}.png`),
      fullPage: true,
    });
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
  // 적의 의도: PC는 가운데 줄, 모바일은 적 칸 아래 꼬리표
  await expect(
    page.getByText(/→ 나$/).filter({ visible: true }).first(),
  ).toBeVisible();
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
  // 내 공격이 들어가고: 베기 6 × 1.09 × 1.5(자상 약함) = 9.8 → 10
  await expect(thisTurn(page)).toContainText("나 → 늑대 10");
  // 적 차례: 나를 노린 공격에 반응을 묻는다
  const reaction = page.getByRole("dialog", { name: "반응" });
  await expect(reaction).toContainText("늑대 → 나");
  await expect(reaction.getByText("10초")).toBeVisible();
  await shot("5-reaction");
  // 막기 성공: 피해 7 × 0.5 = 3.5 → 4, 기력 +1
  await react(page, "막기");
  await expect(page.getByText("제2턴 · 아군 차례")).toBeVisible();
  await expect(thisTurn(page)).toContainText("나 막기 성공");
  await expect(thisTurn(page)).toContainText("늑대 → 나 4");
  // 늑대의 행동(물어뜯기면 출혈 1)은 씨앗에 따라 다르다
  await expect(page.getByText(/체력 5[01]\/55 · 기력 10/)).toBeVisible();
  // 가운데를 치면 완벽: × 1.3 = 12.8 → 13
  await page.getByRole("button", { name: /^기본 공격.*베기/ }).click();
  await page.getByRole("button", { name: "늑대 고르기" }).click();
  await hitCenter(page);
  await expect(thisTurn(page)).toContainText("나 → 늑대 13 (완벽)");

  // 이길 때까지 베기로 치고, 반응은 막기
  for (let turn = 0; turn < 10; turn++) {
    if (await reaction.isVisible()) await react(page, "막기");
    if (await page.getByRole("region", { name: "전투 결과" }).isVisible())
      break;
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
  await expect(
    page.getByRole("heading", { name: "세계수 도서관" }),
  ).toBeVisible();
});

test("연습 전투: 끝까지 누르지 않으면 빗나간다", async ({ page }) => {
  await startPractice(page, "느린 사람");
  await page.getByRole("button", { name: /^기본 공격.*베기/ }).click();
  await page.getByRole("button", { name: "늑대 고르기" }).click();
  await expect(page.getByRole("dialog", { name: "판정 바" })).toBeVisible();
  // 끝(1200ms) 바로 앞까지는 아직 판정하지 않는다
  await page.clock.runFor(1100);
  await expect(page.getByRole("dialog", { name: "판정 바" })).toBeVisible();
  await page.clock.runFor(400);
  await expect(thisTurn(page)).toContainText("나 → 늑대 0 (빗나감)");
});

test("반응: 10초 안에 고르지 않으면 그냥 맞고, 받아치기에 성공하면 피해 없이 반격", async ({
  page,
}) => {
  await startPractice(page, "받아치는 사람");
  await page.getByRole("button", { name: "쉬기" }).click();
  const reaction = page.getByRole("dialog", { name: "반응" });
  await expect(reaction).toBeVisible();
  await page.clock.runFor(9_000);
  await expect(reaction.getByLabel("남은 시간")).toHaveText(/^[12]초$/);
  await page.clock.runFor(1_500);
  await expect(reaction).toHaveCount(0);
  await expect(thisTurn(page)).toContainText("늑대 → 나 7");
  await expect(page.getByText("제2턴 · 아군 차례")).toBeVisible();

  // 되받아치기는 대상 없이 자세를 잡는다
  await page.getByRole("button", { name: /되받아치기/ }).click();
  await react(page, "받아치기");
  await expect(page.getByText("제3턴 · 아군 차례")).toBeVisible();
  await expect(thisTurn(page)).toContainText("나 받아치기 성공");
  // 자세의 반격: 되받아치기 위력 11 × 1.09 × 1.5 = 18. 반격은 흐트러짐을 크게 줘서 늑대가 흐트러진다
  await expect(thisTurn(page)).toContainText("나 → 늑대 18");
  await expect(thisTurn(page)).toContainText("늑대 흐트러짐");
  // 받아친 공격은 피해가 없다 (첫 턴에 맞은 7, 물어뜯기였으면 출혈 1 더)
  await expect(page.getByText(/체력 4[78]\/55/)).toBeVisible();
});

test("제한 시간: 아군 차례 60초가 지나면 그 턴은 자동 규칙으로", async ({
  page,
}) => {
  await startPractice(page, "멍한 사람");
  await expect(page.getByLabel("남은 시간")).toHaveText("60초");
  await page.clock.runFor(30_000);
  await expect(page.getByLabel("남은 시간")).toHaveText("30초");
  await page.clock.runFor(31_000);
  // 자동 규칙이 고른 기술(위력이 가장 큰 검풍)로 쳤다
  await expect(thisTurn(page)).toContainText("나 → 늑대");
});

test("자동 버튼: 켜면 끝까지 자동으로 싸운다", async ({ page }, info) => {
  await startPractice(page, "맡기는 사람");
  await page.getByRole("button", { name: "자동" }).click();
  await expect(page.getByRole("button", { name: "자동 끄기" })).toBeVisible();
  // 기술 패널은 숨는다
  await expect(page.getByRole("region", { name: "기술" })).toHaveCount(0);
  const result = page.getByRole("region", { name: "전투 결과" });
  for (let i = 0; i < 20 && !(await result.isVisible()); i++)
    await page.clock.runFor(1_000);
  await expect(result).toContainText("승리");
  await page.screenshot({
    path: join(shots, `battle-6-auto-${info.project.name}.png`),
    fullPage: true,
  });
});

test("연계 표시, 효과 설명, 자리 옮기기", async ({ page }, info) => {
  await startPractice(page, "살피는 사람");
  const me = page.getByRole("group", { name: "아군" });
  // 1턴: 여는 기술(베기)로 연계를 연다
  await page.getByRole("button", { name: /^기본 공격.*베기/ }).click();
  await page.getByRole("button", { name: "늑대 고르기" }).click();
  // 늑대가 일찍 쓰러지지 않게 좋음으로 친다
  await hitCenter(page, GOOD_MS);
  await settle(page, 2);

  // 2턴: 잇는 기술에 연계 보너스가 보이고, 내 칸에 연계 중
  await expect(page.getByText("연계 중 · 여는")).toBeVisible();
  const combo = page.getByRole("button", { name: /연속 베기/ });
  await expect(combo).toContainText("연계 +10%");
  await expect(
    page.getByRole("button", { name: /^기본 공격.*베기/ }),
  ).not.toContainText("연계");
  await combo.click();
  await page.getByRole("button", { name: "늑대 고르기" }).click();
  for (let hit = 0; hit < 3; hit++) await hitCenter(page, GOOD_MS);
  await settle(page, 3);

  // 늑대에게 붙은 출혈: 누르면 하는 일을 보여 준다
  const bleed = page
    .getByRole("group", { name: "적" })
    .getByRole("button", { name: /^출혈 \d+$/ });
  await expect(bleed).toBeVisible();
  await bleed.click();
  await expect(page.getByRole("region", { name: "이번 턴" })).toContainText(
    "늑대의 출혈: 턴 끝에 중첩만큼 피해 · 턴 끝 −1 · 최대 10",
  );
  await page.screenshot({
    path: join(shots, `battle-7-states-${info.project.name}.png`),
    fullPage: true,
  });

  // 자리 옮기기: 빈 칸을 고르면 기력 1을 쓰고 옮긴다. 뒷줄에서는 근접 기술이 잠긴다
  const energyBefore = Number(
    (await me.getByText(/기력 \d+/).textContent())?.match(/기력 (\d+)/)?.[1],
  );
  await page.getByRole("button", { name: /^자리 옮기기/ }).click();
  await expect(page.getByText("옮겨 갈 빈 칸을 고르세요")).toBeVisible();
  await page.getByRole("button", { name: "뒷줄 2번 칸으로" }).click();
  await expect(page.getByRole("region", { name: "이번 턴" })).toContainText(
    "나 자리 옮김",
  );
  await settle(page, 4);
  // 기력: −1(옮기기) +2(턴 끝), 막기에 성공했으면 +1, 최대 10
  await expect(me.getByText(/기력 \d+/)).toHaveText(
    new RegExp(
      `기력 (${Math.min(10, energyBefore + 1)}|${Math.min(10, energyBefore + 2)})`,
    ),
  );
  await expect(
    page.getByRole("button", { name: /^기본 공격.*베기/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /^기본 공격.*베기/ }),
  ).toContainText("뒷줄에서는 못 씀");
});

test("모바일 배치: 적이 위, 아군이 아래, 의도는 적 칸 아래, 기술 패널은 화면 아래", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "모바일만");
  await startPractice(page, "작은 화면");
  const enemies = await page.getByRole("group", { name: "적" }).boundingBox();
  const allies = await page.getByRole("group", { name: "아군" }).boundingBox();
  expect(enemies && allies && enemies.y < allies.y).toBe(true);
  // 의도는 가운데 줄이 아니라 적 칸 아래 꼬리표로 (대상 이름)
  await expect(page.getByRole("region", { name: "적의 의도" })).toBeHidden();
  await expect(
    page.getByRole("group", { name: "적" }).getByText(/→ 나$/),
  ).toBeVisible();
  // 기술 패널은 화면 아래에 붙어 있다
  const panel = await page.getByRole("region", { name: "기술" }).boundingBox();
  const viewport = page.viewportSize();
  expect(
    panel && viewport && Math.abs(panel.y + panel.height - viewport.height) < 2,
  ).toBe(true);
  // 누르는 것은 44px 이상
  const skill = await page
    .getByRole("button", { name: /^기본 공격.*베기/ })
    .boundingBox();
  expect(skill && skill.height >= 44).toBe(true);
  // 첫 화면에서 내 칸이 패널에 가리지 않는다
  const mine = await page
    .getByRole("group", { name: "아군" })
    .getByText("차례")
    .boundingBox();
  expect(mine && panel && mine.y + mine.height <= panel.y).toBe(true);
  // 실제 휴대폰 화면 크기 그대로 (전체 페이지 캡처는 아래 고정 패널 자리를 다르게 그린다)
  await page.screenshot({
    path: join(shots, `battle-8-phone-${info.project.name}.png`),
  });
});

test("시험 환경에서는 #practice로 로그인 없이 연습장이 열린다", async ({
  page,
}) => {
  await page.goto("/#practice");
  await expect(page.getByRole("heading", { name: "연습 전투" })).toBeVisible();
  await page.getByRole("button", { name: "돌아가기" }).click();
  // 나가면 원래 첫 화면(로그인)으로
  await expect(
    page.getByRole("heading", { name: "도서관 입구" }),
  ).toBeVisible();
});
