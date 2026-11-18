import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
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
const SEASON = "514-summer";

test("투기장: 빌드를 등록하고, 순위표에서 상대를 골라 그림자를 이기면 점수가 오른다", async ({
  page,
}, info) => {
  const p = info.project.name;
  const account = `투기장 손님 ${p}`;
  const characterId = `arena-${p}`;
  const opponentId = `arena-opp-${p}`;
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
  character.mastery["sword"] = { value: 50, passed60: false, passed80: false };
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
    // 먼저 등록해 둔 상대 (기본 공격만 쓰는 검사)
    [`arena/${SEASON}/entries/${opponentId}`]: {
      build: {
        name: `메멜 ${p}`,
        health: 50,
        treeId: "sword",
        treeVersion: rawSword.version,
        mastery: 30,
      },
      registeredAt: Date.now(),
      score: 1000,
      wins: 3,
      losses: 1,
    },
  });
  await expect(page.getByText("하린").first()).toBeVisible();
  await page.getByRole("button", { name: "투기장 (시험 환경)" }).click();
  await expect(
    page.getByRole("heading", { name: "브라켄 투기장" }),
  ).toBeVisible();

  const duel = page.getByRole("region", { name: "결투 신청" });
  await expect(duel).toContainText("먼저 내 빌드를 등록해야");
  await page
    .getByRole("region", { name: "내 빌드" })
    .getByRole("button", { name: "빌드 등록" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "투기장에 빌드를 등록했어요",
  );
  const board = page.getByRole("region", { name: "계절 순위표" });
  await expect(board).toContainText("하린 (나)");

  await board.getByRole("button", { name: `메멜 ${p} 고르기` }).click();
  await expect(duel).toContainText(`메멜 ${p}에게`);
  await expect(duel).toContainText("베기");
  await page.screenshot({
    path: join(shots, `arena-1-board-${p}.png`),
    fullPage: true,
  });
  await duel.getByRole("button", { name: "결투 신청" }).click();

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

  await expect(page.getByRole("status")).toContainText(
    `메멜 ${p}의 그림자에게 이겼어요 · 점수 +16 (1016)`,
  );
  await expect(board.getByRole("row").nth(1)).toContainText("하린 (나)");
  await page.screenshot({
    path: join(shots, `arena-2-won-${p}.png`),
    fullPage: true,
  });
  const mine = (await admin.get(`arena/${SEASON}/entries/${characterId}`)) as {
    score: number;
    wins: number;
  };
  expect(mine).toMatchObject({ score: 1016, wins: 1 });
  expect(await admin.get(`arena/${SEASON}/entries/${opponentId}/score`)).toBe(
    1000,
  );
  expect(await admin.get(`arena/${SEASON}/log/${opponentId}`)).not.toBeNull();
  expect(
    await admin.get(`characters/${characterId}/month/fatigue/training`),
  ).toBe(1);
});
