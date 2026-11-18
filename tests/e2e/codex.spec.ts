import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import rawLimits from "../../data/defs/limits.json" with { type: "json" };
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

test("도감: 싸운 만큼 드러나고, 모르는 것은 ???", async ({ page }, info) => {
  const p = info.project.name;
  const account = `도감 손님 ${p}`;
  const characterId = `codex-${p}`;
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
  character.codex = {
    enemies: { wolf: 15, boar: 1, wolf_alpha: 0 },
    items: { "wolf-pelt": Date.parse("2026-11-01T12:00:00Z") },
  };
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
  await page.getByRole("button", { name: "도감" }).click();
  await expect(
    page.getByRole("heading", { name: "도감", exact: true }),
  ).toBeVisible();

  const grid = page.getByRole("region", { name: "적 도감" });
  await expect(grid).toContainText("적 도감 · 3 /");
  await expect(
    grid.getByRole("button", { name: /늑대 도감 완성/ }),
  ).toBeVisible();
  await expect(
    grid.getByRole("button", { name: /늑대 우두머리 처음 봄/ }),
  ).toBeVisible();
  await expect(
    grid.getByRole("button", { name: /\?\?\?/ }).first(),
  ).toBeDisabled();

  const detail = page.getByRole("region", { name: "적 자세히" });
  await grid.getByRole("button", { name: /멧돼지/ }).click();
  await expect(detail).toContainText("저항");
  await expect(detail).toContainText("자상 약함");
  await expect(detail.getByText("???").first()).toBeVisible();
  await grid.getByRole("button", { name: /늑대 도감 완성/ }).click();
  await expect(detail).toContainText("국경 숲길");
  await expect(detail).toContainText("늑대 가죽");
  await page.screenshot({
    path: join(shots, `codex-1-enemies-${p}.png`),
    fullPage: true,
  });

  await page.getByRole("button", { name: "물건", exact: true }).click();
  const items = page.getByRole("region", { name: "물건 도감" });
  await expect(items).toContainText("늑대 가죽");
  await expect(items).toContainText("처음 얻음");
  await expect(items).toContainText("???");
  await page.screenshot({
    path: join(shots, `codex-2-items-${p}.png`),
    fullPage: true,
  });
});
