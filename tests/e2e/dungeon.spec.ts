import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import rawDungeons from "../../data/defs/dungeons.json" with { type: "json" };
import rawItems from "../../data/defs/items.json" with { type: "json" };
import rawLimits from "../../data/defs/limits.json" with { type: "json" };
import { emulatorAdminPort } from "../../src/data/emulator-admin";
import { selectEnv } from "../../src/data/env";
import { newCharacter } from "../../src/rules/character";
import { startExpedition } from "../../src/rules/dungeon/explore";
import { generateFloor } from "../../src/rules/dungeon/floor";
import { DungeonListSchema } from "../../src/schema/defs/dungeon";
import { ItemListSchema } from "../../src/schema/defs/item";
import { LimitsSchema } from "../../src/schema/defs/limits";
import { toStored } from "../../src/schema/expedition";

const shots =
  process.env["GARDEN_SHOTS"] ??
  join(import.meta.dirname, "..", "..", "test-results", "shots");
mkdirSync(shots, { recursive: true });
const env = selectEnv("emulator", { isTest: true });
const admin = emulatorAdminPort(env);
const limits = LimitsSchema.parse(rawLimits);
const forest = DungeonListSchema.parse(rawDungeons).dungeons.find(
  (d) => d.id === "border-forest",
)!;
const items = new Map(
  ItemListSchema.parse(rawItems).items.map((i) => [i.id, i]),
);

async function enter(page: Page, name: string) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "도서관 입구" }),
  ).toBeVisible();
  await page.getByLabel("시험 계정 이름").fill(name);
  await page.getByRole("button", { name: "시험 계정으로 들어가기" }).click();
  await expect(
    page.getByRole("heading", { name: "세계수 도서관", exact: true }),
  ).toBeVisible();
}

/** 가짜 캐릭터(검술 숙련 30, 건강 50)를 만들어 계정에 잇는다. expedition을 주면 그 탐험 중인 채로 */
async function linkFakeCharacter(
  account: string,
  characterId: string,
  expedition?: unknown,
) {
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
  character.mastery["sword"] = { value: 30, passed60: false, passed80: false };
  character.abilities.health = 50;
  // 들어가기는 오늘의 피로(달 칸)를 쓰므로 세계의 달이 있어야 한다 (가짜 캐릭터와 같은 514-3)
  if ((await admin.get("world/clock")) == null) {
    await admin.update({
      "world/clock": {
        year: 514,
        monthIndex: 3,
        monthKey: "514-3",
        lastDateKey: "2026-11-17",
        computing: false,
      },
    });
  }
  await admin.update({
    [`characters/${characterId}`]: {
      ...character,
      ...(expedition ? { expedition } : {}),
    },
    [`accounts/${uid}/characterId`]: characterId,
  });
}

/** 시작방 옆에 늑대 하나 방과 쉼터가 모두 붙은 씨앗 */
function pickSeed() {
  for (let s = 0; ; s++) {
    const seed = `e2e-${s}`;
    const floor = generateFloor(forest, 1, seed, items, 1);
    const start = floor.rooms[floor.start]!;
    const wolf = start.doors.find((d) => {
      const room = floor.rooms[d]!;
      return (
        room.kind === "전투" &&
        room.group?.enemies.length === 1 &&
        room.loot.some((p) => p.kind !== "열쇠" && p.kind !== "폭약")
      );
    });
    if (wolf !== undefined && start.doors.includes(floor.rest))
      return { seed, floor, wolf };
  }
}

const dirOf = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  to.x > from.x ? "동" : to.x < from.x ? "서" : to.y < from.y ? "북" : "남";

test("던전 입구: 들어가면 시작방과 작은 지도, 새로 고쳐도 이어진다", async ({
  page,
}, info) => {
  const p = info.project.name;
  await enter(page, `던전 A ${p}`);
  await linkFakeCharacter(`던전 A ${p}`, `dg-a-${p}`);
  await expect(page.getByText("하린").first()).toBeVisible();
  await page.getByRole("button", { name: "던전 (시험 환경)" }).click();
  const gate = page.getByRole("region", { name: "던전 입구" });
  await expect(gate).toContainText("국경 숲길");
  await expect(gate).toContainText("오늘 피로");
  await page.screenshot({
    path: join(shots, `dungeon-1-gate-${p}.png`),
    fullPage: true,
  });
  await gate.getByRole("button", { name: "들어가기" }).click();

  const room = page.getByRole("region", { name: "지금 있는 방" });
  await expect(room.getByRole("heading", { name: "시작방" })).toBeVisible();
  await expect(page.getByRole("img", { name: "밝혀진 방들" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /국경 숲길 · 첫째 층/ }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "세계수 도서관", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "던전 (시험 환경)" }).click();
  await expect(
    page
      .getByRole("region", { name: "지금 있는 방" })
      .getByRole("heading", { name: "시작방" }),
  ).toBeVisible();
  const saved = (await admin.get(
    `characters/dg-a-${p}/month/fatigue/explore`,
  )) as number;
  expect(saved).toBe(1);
});

test("던전 탐험: 싸워 이기고, 줍고, 쉼터에서 귀환하면 가방에 들어간다", async ({
  page,
}, info) => {
  const p = info.project.name;
  const { seed, floor, wolf } = pickSeed();
  const state = startExpedition({
    dungeonId: forest.id,
    seed,
    now: Date.now(),
    fatigueIndex: 1,
    maxHp: 100,
    maxEnergy: 6,
    firstFloor: floor,
  });
  state.gains = [{ kind: "잎전", quantity: 25 }];
  await page.clock.install();
  await enter(page, `던전 B ${p}`);
  await linkFakeCharacter(
    `던전 B ${p}`,
    `dg-b-${p}`,
    toStored("e2e-run", state),
  );
  await expect(page.getByText("하린").first()).toBeVisible();
  await page.getByRole("button", { name: "던전 (시험 환경)" }).click();

  const room = page.getByRole("region", { name: "지금 있는 방" });
  const start = floor.rooms[floor.start]!;
  await room
    .getByRole("button", {
      name: new RegExp(`^.*${dirOf(start, floor.rooms[wolf]!)}`),
    })
    .click();
  await expect(room).toContainText("문이 닫혔다");
  await page.screenshot({
    path: join(shots, `dungeon-2-room-${p}.png`),
    fullPage: true,
  });
  await room.getByRole("button", { name: "싸우기" }).click();

  // 던전 싸움에는 도망·그만두기가 없다
  await expect(page.getByText("제1턴 · 아군 차례")).toBeVisible();
  await expect(page.getByRole("button", { name: "그만두기" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "도망" })).toHaveCount(0);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));
  await page.getByRole("button", { name: "자동" }).click();
  const result = page.getByRole("region", { name: "전투 결과" });
  for (let i = 0; i < 40 && !(await result.isVisible()); i++)
    await page.clock.runFor(1_000);
  await expect(result).toContainText("승리");
  await result.getByRole("button", { name: "계속" }).click();
  await page.clock.resume();

  await expect(
    room.getByRole("heading", { name: "전투방 · 정리됨" }),
  ).toBeVisible();
  const loot = room.getByRole("list", { name: "주울 것" });
  const lootCount = await loot.getByRole("button", { name: "줍기" }).count();
  expect(lootCount).toBeGreaterThan(0);
  for (let i = 0; i < lootCount; i++)
    await loot.getByRole("button", { name: "줍기" }).first().click();
  await expect(loot).toHaveCount(0);

  // 시작방으로 돌아가 쉼터로
  await room
    .getByRole("button", { name: new RegExp(dirOf(floor.rooms[wolf]!, start)) })
    .click();
  await room
    .getByRole("button", {
      name: new RegExp(dirOf(start, floor.rooms[floor.rest]!)),
    })
    .click();
  await expect(room.getByRole("heading", { name: "쉼터방" })).toBeVisible();
  await page.screenshot({
    path: join(shots, `dungeon-3-rest-${p}.png`),
    fullPage: true,
  });
  await room.getByRole("button", { name: "귀환 (전부 가져감)" }).click();
  await room.getByRole("button", { name: "정리하기" }).click();
  const settled = page.getByRole("region", { name: "탐험 정리" });
  await expect(settled).toContainText("잎전");
  await page.screenshot({
    path: join(shots, `dungeon-4-settled-${p}.png`),
    fullPage: true,
  });

  const c = (await admin.get(`characters/dg-b-${p}`)) as {
    wallet: number;
    expedition?: unknown;
    life: { text: string }[];
  };
  expect(c.expedition).toBeUndefined();
  expect(c.wallet).toBeGreaterThanOrEqual(25);
  expect(c.life.at(-1)?.text).toContain("쉼터에서 귀환");
});
