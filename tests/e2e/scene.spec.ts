import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import rawLimits from "../../data/defs/limits.json" with { type: "json" };
import { emulatorAdminPort } from "../../src/data/emulator-admin";
import { selectEnv } from "../../src/data/env";
import { newCharacter } from "../../src/rules/character";
import { LimitsSchema } from "../../src/schema/defs/limits";

const shots = process.env["GARDEN_SHOTS"] ?? join(import.meta.dirname, "..", "..", "test-results", "shots");
mkdirSync(shots, { recursive: true });
const env = selectEnv("emulator", { isTest: true });
const admin = emulatorAdminPort(env);
const limits = LimitsSchema.parse(rawLimits);

async function enter(page: Page, name: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "도서관 입구" })).toBeVisible();
  await page.getByLabel("시험 계정 이름").fill(name);
  await page.getByRole("button", { name: "시험 계정으로 들어가기" }).click();
  await expect(page.getByRole("heading", { name: "세계수 도서관" })).toBeVisible();
}

/** 가짜 캐릭터를 만들어 지금 계정에 잇는다 (실제 데이터가 아니다) */
async function linkFakeCharacter(name: string, characterId: string) {
  const accounts = ((await admin.get("accounts")) ?? {}) as Record<string, { displayName?: string }>;
  const uid = Object.entries(accounts).find(([, a]) => a.displayName === name)?.[0];
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
  await admin.update({ [`characters/${characterId}`]: character, [`accounts/${uid}/characterId`]: characterId });
}

/** 대사를 넘기며 target이 보일 때까지 */
async function advanceUntil(page: Page, target: Locator) {
  for (let i = 0; i < 80 && !(await target.isVisible()); i++) {
    await page.keyboard.press("Space");
  }
  await expect(target).toBeVisible();
}

test("장면 보기: 한 줄씩 넘기고, 고르고, 끝나면 결과를 한 번에 기록한다", async ({ page }, info) => {
  const shot = (n: string) => page.screenshot({ path: join(shots, `scene-${n}-${info.project.name}.png`) });
  const name = `장면 보는 사람 ${info.project.name}`;
  const characterId = `scene-${info.project.name}`;
  await enter(page, name);
  await linkFakeCharacter(name, characterId);
  await expect(page.getByText("하린").first()).toBeVisible();

  await page.getByRole("button", { name: "장면 보기 (시험 환경)" }).click();
  await expect(page.getByRole("heading", { name: "장면 보기" })).toBeVisible();
  await page.getByRole("searchbox").fill("intro_new_shelf");
  await page.getByRole("button", { name: "intro_new_shelf" }).click();

  const box = page.getByRole("region", { name: "대사창" });
  await expect(box).toContainText("종이 냄새가 먼저 돌아왔다.");
  await advanceUntil(page, box.getByText("깨셨군요, 하린."));
  await expect(box.getByText("사서", { exact: true })).toBeVisible();
  await shot("1-line");

  const choices = page.getByRole("group", { name: "선택지" });
  await advanceUntil(page, choices);
  await shot("2-choice");
  await choices.getByRole("button", { name: "무슨 소란이었는데요?" }).click();
  await expect(box).toContainText("책들은 가끔 이래요.");

  // 지난 대사
  await page.getByRole("button", { name: "지난 대사" }).click();
  await expect(page.getByRole("region", { name: "지난 대사" })).toContainText("종이 냄새가 먼저 돌아왔다.");
  await page.getByRole("button", { name: "지난 대사" }).click();

  // 끝나면 결과를 한 번에
  const end = page.getByRole("group", { name: "장면 끝" });
  await advanceUntil(page, end);
  await expect(end).toContainText("퀘스트 가문 1막: 진행");
  await shot("3-end");
  const saved = (await admin.get(`characters/${characterId}`)) as { profile: { marks: string[] }; scenes: Record<string, { choices: string[] }>; quests: unknown[] };
  expect(saved.profile.marks).toContain("새_책장을_봄");
  expect(saved.scenes["intro_new_shelf"]?.choices).toEqual(["무슨 소란이었는데요?"]);
  expect(saved.quests).toEqual([{ id: "가문_1막", state: "진행", steps: 1 }]);

  // 다시 보면 결과는 다시 들어가지 않는다
  await end.getByRole("button", { name: "닫기" }).click();
  await expect(page.getByRole("button", { name: /intro_new_shelf · 봄/ })).toBeVisible();
  await page.getByRole("button", { name: /intro_new_shelf/ }).click();
  for (let i = 0; i < 80 && !(await choices.isVisible()) && !(await end.isVisible()); i++) await page.keyboard.press("Space");
  if (await choices.isVisible()) await choices.getByRole("button").first().click();
  await advanceUntil(page, end);
  await expect(end).toContainText("이미 본 장면이라 결과는 다시 들어가지 않아요.");

  // 중간에 닫으면 아무것도 기록하지 않는다
  await end.getByRole("button", { name: "닫기" }).click();
  await page.getByRole("searchbox").fill("guide_hwangdo_start");
  await page.getByRole("button", { name: "guide_hwangdo_start" }).click();
  await page.keyboard.press("Space");
  await page.getByRole("main", { name: "장면" }).getByRole("button", { name: "닫기" }).first().click();
  expect(((await admin.get(`characters/${characterId}/scenes`)) ?? {}) as object).not.toHaveProperty("guide_hwangdo_start");
});
