import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import rawLimits from "../../data/defs/limits.json" with { type: "json" };
import rawRaids from "../../data/defs/raids.json" with { type: "json" };
import rawSword from "../../data/defs/trees/sword.json" with { type: "json" };
import { emulatorAdminPort } from "../../src/data/emulator-admin";
import { selectEnv } from "../../src/data/env";
import { newCharacter } from "../../src/rules/character";
import { raidWeek } from "../../src/rules/raid";
import { LimitsSchema } from "../../src/schema/defs/limits";
import { RaidDefsSchema } from "../../src/schema/defs/raid";

const shots =
  process.env["GARDEN_SHOTS"] ??
  join(import.meta.dirname, "..", "..", "test-results", "shots");
mkdirSync(shots, { recursive: true });
const admin = emulatorAdminPort(selectEnv("emulator", { isTest: true }));
const limits = LimitsSchema.parse(rawLimits);
const raids = RaidDefsSchema.parse(rawRaids);

/** 도전해서 자동으로 끝까지 싸우고, 이겼는지 돌려준다 */
async function fightOnce(page: Page): Promise<boolean> {
  await page
    .getByRole("region", { name: "이번 주 보스" })
    .getByRole("button", { name: "도전" })
    .click();
  await expect(page.getByText("제1턴 · 아군 차례")).toBeVisible();
  await expect(page.getByRole("button", { name: "도망" })).toHaveCount(0);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.getByRole("button", { name: "자동" }).click();
  const battle = page.getByRole("region", { name: "전투 결과" });
  for (let i = 0; i < 80 && !(await battle.isVisible()); i++)
    await page.clock.runFor(1_000);
  const won = (await battle.textContent())?.includes("승리") ?? false;
  await battle.getByRole("button", { name: "계속" }).click();
  await page.clock.resume();
  await expect(
    page.getByRole("region", { name: "레이드 결과" }).getByRole("status"),
  ).toBeVisible();
  return won;
}

test("반복 레이드: 이번 주 보스를 이기면 주간 보상, 다시 이기면 일반 보상, 기여 점수가 남는다", async ({
  page,
}, info) => {
  const p = info.project.name;
  const account = `레이드 손님 ${p}`;
  const characterId = `raid-${p}`;
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
  // 레이드를 넘을 만큼 키운 검사
  character.abilities.health = 100;
  character.mastery["sword"] = { value: 90, passed60: true, passed80: true };
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
  await page.getByRole("button", { name: "반복 레이드 (시험 환경)" }).click();
  const week = raidWeek(Date.now(), raids, limits);
  const bossCard = page.getByRole("region", { name: "이번 주 보스" });
  await expect(
    bossCard.getByRole("heading", { name: week.boss.name }),
  ).toBeVisible();
  await page.screenshot({
    path: join(shots, `raid-1-boss-${p}.png`),
    fullPage: true,
  });

  const money = week.boss.weekly.find((r) => r.kind === "잎전")?.quantity ?? 0;
  const result = page.getByRole("region", { name: "레이드 결과" });
  let tries = 0;
  while (!(await fightOnce(page))) {
    // 지면 보상 없이 기여만 남는다
    await expect(result).toContainText("밀려났어요");
    if (++tries >= 5) throw new Error("다섯 번 모두 졌다");
  }
  await expect(result).toContainText("주간 보상");
  await expect(result).toContainText(`${money} 잎전`);
  await expect(result).toContainText("이번 판 기여");
  await expect(bossCard).toContainText("이번 주에 받았어요");
  await page.screenshot({
    path: join(shots, `raid-2-weekly-${p}.png`),
    fullPage: true,
  });
  const wallet = (await admin.get(
    `characters/${characterId}/wallet`,
  )) as number;
  expect(wallet).toBe(character.wallet + money);

  tries = 0;
  while (!(await fightOnce(page)))
    if (++tries >= 5) throw new Error("다섯 번 모두 졌다");
  await expect(result).not.toContainText("주간 보상");
  await expect(result).toContainText("보상:");
  expect(await admin.get(`characters/${characterId}/wallet`)).toBe(wallet);
  await expect(
    page.getByRole("region", { name: "이번 주 기여" }),
  ).toContainText("하린");
  const record = (await admin.get(
    `raids/${week.key}/records/${characterId}`,
  )) as { score: number } | null;
  expect(record?.score).toBeGreaterThan(0);
  expect(
    (await admin.get(`characters/${characterId}/month/fatigue/raid`)) as number,
  ).toBeGreaterThanOrEqual(2);
});
