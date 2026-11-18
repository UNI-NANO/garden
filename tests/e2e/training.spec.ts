import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import rawLimits from "../../data/defs/limits.json" with { type: "json" };
import rawSword from "../../data/defs/trees/sword.json" with { type: "json" };
import { emulatorAdminPort } from "../../src/data/emulator-admin";
import { selectEnv } from "../../src/data/env";
import { newCharacter } from "../../src/rules/character";
import { LimitsSchema } from "../../src/schema/defs/limits";

const shots =
  process.env["GARDEN_SHOTS"] ??
  join(import.meta.dirname, "..", "..", "test-results", "shots");
mkdirSync(shots, { recursive: true });
const admin = emulatorAdminPort(selectEnv("emulator", { isTest: true }));
const limits = LimitsSchema.parse(rawLimits);

/** 검술 숙련도를 정해 둔 캐릭터로 들어가 훈련장을 연다 */
async function enterTraining(
  page: Page,
  account: string,
  characterId: string,
  mastery: number,
) {
  await page.goto("/");
  await page.getByLabel("시험 계정 이름").fill(account);
  await page.getByRole("button", { name: "시험 계정으로 들어가기" }).click();
  await expect(
    page.getByRole("heading", { name: "세계수 도서관", exact: true }),
  ).toBeVisible();
  const accounts = ((await admin.get("accounts")) ?? {}) as Record<
    string,
    { displayName?: string }
  >;
  const uid = Object.entries(accounts).find(
    ([, a]) => a.displayName === account,
  )?.[0];
  if (!uid) throw new Error("계정을 찾지 못했다");
  const character = newCharacter(limits, {
    owner: uid,
    name: "하린",
    gender: "여",
    origin: { realm: "제국", region: "황도", place: "장터 골목" },
    chosenTalents: ["agility", "sturdy", "intuition"],
    monthKey: "514-3",
    now: Date.now(),
    stage: "살아 있음",
  });
  character.mastery["sword"] = {
    value: mastery,
    passed60: false,
    passed80: false,
  };
  // 60 벽에 닿을 만큼 키운 검사: 기본기 둘을 찍고 장착
  character.trees["sword"] = {
    treeVersion: rawSword.version,
    picked: { sword_combo: true, sword_gale: true },
    choices: {},
    spent: { branch: 2, root: 0 },
  };
  character.loadout = { basics: ["sword.combo", "sword.gale"] };
  await admin.update({
    "world/clock": {
      year: 514,
      monthIndex: 3,
      monthKey: "514-3",
      lastDateKey: "2026-11-17",
      computing: false,
    },
    [`characters/${characterId}`]: character,
    [`accounts/${uid}/characterId`]: characterId,
  });
  await expect(page.getByText("하린").first()).toBeVisible();
  await page.getByRole("button", { name: "훈련장 (시험 환경)" }).click();
  await expect(
    page.getByRole("heading", { name: "라인펠트 아랫마을 훈련장" }),
  ).toBeVisible();
}

test("허수아비: 치면 피해 숫자가 나오고, 맞아도 다치지 않는다", async ({
  page,
}, info) => {
  const p = info.project.name;
  await enterTraining(page, `허수아비 치는 사람 ${p}`, `dummy-${p}`, 30);
  await expect(page.getByText("지금 넘을 벽이 없어요.")).toBeVisible();
  await expect(
    page.getByText("검술 30.00 · 60 벽 아직 · 80 벽 아직"),
  ).toBeVisible();
  await page.screenshot({
    path: join(shots, `training-1-yard-${p}.png`),
    fullPage: true,
  });

  await page
    .getByRole("region", { name: "허수아비" })
    .getByRole("button", { name: "치기" })
    .click();
  await expect(page.getByText("제1턴 · 아군 차례")).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.getByRole("button", { name: "자동" }).click();
  for (let i = 0; i < 4; i++) await page.clock.runFor(1_000);
  await expect(page.getByRole("region", { name: "이번 턴" })).toContainText(
    /허수아비/,
  );
  // 허수아비의 위력은 0이라 체력이 그대로
  await expect(page.getByText(/체력 (\d+)\/\1 ·/)).toBeVisible();
  await page.clock.resume();
  await page.screenshot({
    path: join(shots, `training-2-dummy-${p}.png`),
    fullPage: true,
  });
  await page.getByRole("button", { name: "그만두기" }).click();
  await expect(
    page.getByRole("heading", { name: "라인펠트 아랫마을 훈련장" }),
  ).toBeVisible();
  const fatigue = await admin.get(
    `characters/dummy-${p}/month/fatigue/training`,
  );
  expect(fatigue ?? 0).toBe(0);
});

test("교관 대련: 59.99에 막힌 검술로 늙은 교관을 이기면 60 벽 통과", async ({
  page,
}, info) => {
  const p = info.project.name;
  await enterTraining(page, `벽 앞의 사람 ${p}`, `wall-${p}`, 59.99);
  const duel = page.getByRole("region", { name: "교관 대련" });
  await expect(duel).toContainText("검술 60 벽 시험");
  await expect(duel).toContainText("늙은 교관");
  await page.screenshot({
    path: join(shots, `training-3-wall-${p}.png`),
    fullPage: true,
  });
  await duel.getByRole("button", { name: "도전" }).click();

  await expect(page.getByText("제1턴 · 아군 차례")).toBeVisible();
  await expect(page.getByRole("button", { name: "도망" })).toHaveCount(0);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.getByRole("button", { name: "자동" }).click();
  const result = page.getByRole("region", { name: "전투 결과" });
  for (let i = 0; i < 60 && !(await result.isVisible()); i++)
    await page.clock.runFor(1_000);
  await expect(result).toContainText("승리");
  await result.getByRole("button", { name: "계속" }).click();
  await page.clock.resume();

  await expect(page.getByRole("status")).toContainText("검술 60 벽을 넘었어요");
  await expect(
    page.getByText("검술 59.99 · 60 벽 통과 · 80 벽 아직"),
  ).toBeVisible();
  await page.screenshot({
    path: join(shots, `training-4-passed-${p}.png`),
    fullPage: true,
  });
  const saved = (await admin.get(`characters/wall-${p}`)) as {
    mastery: Record<string, { passed60: boolean }>;
    month: { fatigue: Record<string, number> };
    life: { text: string }[];
  };
  expect(saved.mastery["sword"]?.passed60).toBe(true);
  expect(saved.month.fatigue["training"]).toBe(1);
  expect(saved.life.at(-1)?.text).toBe(
    "검술 60 벽을 넘었다 — 늙은 교관과의 대련",
  );
});
