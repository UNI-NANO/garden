import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import rawCrafting from "../../data/defs/crafting.json" with { type: "json" };
import rawLimits from "../../data/defs/limits.json" with { type: "json" };
import { emulatorAdminPort } from "../../src/data/emulator-admin";
import { selectEnv } from "../../src/data/env";
import { newCharacter } from "../../src/rules/character";
import { CraftingDefsSchema } from "../../src/schema/defs/crafting";
import { LimitsSchema } from "../../src/schema/defs/limits";

const shots =
  process.env["GARDEN_SHOTS"] ??
  join(import.meta.dirname, "..", "..", "test-results", "shots");
mkdirSync(shots, { recursive: true });
const admin = emulatorAdminPort(selectEnv("emulator", { isTest: true }));
const limits = LimitsSchema.parse(rawLimits);
const crafting = CraftingDefsSchema.parse(rawCrafting);

async function enterWithCharacter(
  page: Page,
  account: string,
  characterId: string,
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
  character.bag.stacks = {
    m1: { itemId: "hill-mugwort", quantity: 4, freshness: 100, quality: "상" },
    b1: {
      itemId: "bloodstop-herb",
      quantity: 2,
      freshness: 100,
      quality: "상",
    },
    s1: {
      itemId: "silver-willow-leaf",
      quantity: 2,
      freshness: 100,
      quality: "중",
    },
  };
  await admin.update({
    [`characters/${characterId}`]: character,
    [`accounts/${uid}/characterId`]: characterId,
  });
  await expect(page.getByText("하린").first()).toBeVisible();
}

test("제작: 약방에서 기본 레시피로 지혈 연고를 빻아 만들고, 조합 시도로 새 레시피를 알아낸다", async ({
  page,
}, info) => {
  const p = info.project.name;
  const shot = (name: string) =>
    page.screenshot({
      path: join(shots, `crafting-${name}-${p}.png`),
      fullPage: true,
    });
  const apothecary = crafting.stations.find((s) => s.id === "apothecary")!;
  await page.clock.install();
  await enterWithCharacter(page, `제작 ${p}`, `craft-${p}`);
  await page.getByRole("button", { name: "제작 (시험 환경)" }).click();
  await page
    .getByRole("navigation", { name: "작업장" })
    .getByRole("button", { name: "약방" })
    .click();
  const recipes = page.getByRole("region", { name: "아는 레시피" });
  await expect(recipes).toContainText("지혈 연고");
  await expect(recipes).not.toContainText("해독 찜질");
  await shot("1-recipes");

  // 빻기 세 번: 매번 가운데에서 누른다
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await recipes
    .getByRole("listitem")
    .filter({ hasText: "지혈 연고" })
    .getByRole("button", { name: "만들기" })
    .click();
  for (let hit = 0; hit < apothecary.game.hits; hit++) {
    const bar = page.getByRole("dialog", { name: "판정 바" });
    await expect(bar).toContainText(`${hit + 1}타 / ${apothecary.game.hits}타`);
    if (hit === 0) await shot("2-grind");
    await page.clock.runFor(apothecary.game.sweepMs / 2);
    await bar.dispatchEvent("pointerdown");
    await page.clock.runFor(50);
  }
  await page.clock.resume();
  await expect(page.getByRole("status")).toContainText(
    "지혈 연고를 만들었어요",
  );
  await expect(page.getByRole("status")).toContainText("품질");

  // 조합 시도: 은버들잎 + 산쑥 → 해독 찜질
  const combine = page.getByRole("region", { name: "조합 시도" });
  await combine.getByRole("button", { name: "은버들잎 넣기" }).click();
  await combine.getByRole("button", { name: "산쑥 넣기" }).click();
  await combine.getByRole("button", { name: "넣어 보기" }).click();
  await expect(page.getByRole("status")).toContainText(
    "새 레시피를 알아냈어요: 해독 찜질",
  );
  await expect(recipes).toContainText("해독 찜질");
  await shot("3-learned");

  const c = (await admin.get(`characters/craft-${p}`)) as {
    bag: { stacks: Record<string, { itemId: string; quantity: number }> };
    recipes?: Record<string, boolean>;
  };
  expect(
    Object.values(c.bag.stacks).find((s) => s.itemId === "hemostatic-salve")
      ?.quantity,
  ).toBe(1);
  expect(c.recipes?.["detox-poultice"]).toBe(true);
});

test("강화: 대장간에서 장검을 맡기면 +1이 되고, 다음 확률과 비용이 보인다", async ({
  page,
}, info) => {
  const p = info.project.name;
  await page.goto("/");
  await page.getByLabel("시험 계정 이름").fill(`강화 ${p}`);
  await page.getByRole("button", { name: "시험 계정으로 들어가기" }).click();
  await expect(
    page.getByRole("heading", { name: "세계수 도서관", exact: true }),
  ).toBeVisible();
  const accounts = ((await admin.get("accounts")) ?? {}) as Record<
    string,
    { displayName?: string }
  >;
  const uid = Object.entries(accounts).find(
    ([, a]) => a.displayName === `강화 ${p}`,
  )![0];
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
  character.wallet = 1000;
  character.bag.uniques = {
    sword: {
      itemId: "knights-longsword",
      enhance: 0,
      durability: 100,
      quality: "상",
    },
  };
  character.bag.stacks = {
    i1: { itemId: "iron-scrap", quantity: 10, freshness: 100, quality: "중" },
  };
  await admin.update({
    [`characters/enh-${p}`]: character,
    [`accounts/${uid}/characterId`]: `enh-${p}`,
  });
  await expect(page.getByText("하린").first()).toBeVisible();

  await page.getByRole("button", { name: "제작 (시험 환경)" }).click();
  await page
    .getByRole("navigation", { name: "작업장" })
    .getByRole("button", { name: "대장간" })
    .click();
  const panel = page.getByRole("region", { name: "강화" });
  await expect(panel).toContainText("성공 100%");
  await panel.getByRole("button", { name: "맡기기" }).click();
  await expect(panel.getByRole("status", { name: "강화 결과" })).toContainText(
    "성공! 기사의 장검 +1",
  );
  await expect(panel).toContainText("성공 85%");
  await page.screenshot({
    path: join(shots, `crafting-4-enhance-${p}.png`),
    fullPage: true,
  });
  const saved = (await admin.get(`characters/enh-${p}`)) as {
    wallet: number;
    bag: { uniques: Record<string, { enhance: number }> };
  };
  expect(saved.bag.uniques["sword"]?.enhance).toBe(1);
  expect(saved.wallet).toBe(1000 - 30);
});
