import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
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
  // 피로(달 칸)를 쓰려면 세계의 달이 있어야 한다 (가짜 캐릭터와 같은 514-3)
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
}

test("채집: 잎 뒤를 보고 약초는 조심히 캐고 독초는 두고 간다. 비가 오면 정리해 가방에", async ({
  page,
}, info) => {
  const p = info.project.name;
  const shot = (name: string) =>
    page.screenshot({
      path: join(shots, `gathering-${name}-${p}.png`),
      fullPage: true,
    });
  await enterWithCharacter(page, `채집 ${p}`, `gather-${p}`);
  await page.getByRole("button", { name: "채집 (시험 환경)" }).click();
  const slope = page.getByRole("group", { name: "산비탈의 풀" });
  await expect(slope).toBeVisible();
  await expect(page.getByRole("status")).toContainText("남은 시간 12 / 12");
  await shot("1-slope");

  const close = page.getByRole("region", { name: "가까이 보기" });
  const summary = page.getByRole("region", { name: "채집 정리" });
  let dug = 0;
  let left = 0;
  for (let i = 0; i < 20 && !(await summary.isVisible()); i++) {
    // 아직 잎 뒤를 보지 않은 풀 하나
    const plant = slope
      .getByRole("button", { name: /^풀 \d+: .*처럼 보이는 풀$/ })
      .first();
    if ((await plant.count()) === 0) break;
    await plant.click();
    await close.getByRole("button", { name: /잎 뒤 보기/ }).click();
    if (i === 0) await shot("2-close");
    // 잎 뒤 보기로 시간이 다 떨어지면 비가 와서 바로 정리된다
    if (await summary.isVisible()) break;
    const back = (
      await close.locator("dt:has-text('잎 뒤') + dd").textContent()
    )?.trim();
    const known = (await close.locator(".gt__known").textContent()) ?? "";
    if (back && known.trim().endsWith(`잎 뒤 ${back}`)) {
      const careful = close.getByRole("button", { name: /조심히 캐기/ });
      if (!(await careful.isEnabled())) {
        await close.getByRole("button", { name: /빨리 뜯기/ }).click();
      } else await careful.click();
      dug++;
    } else {
      await close.getByRole("button", { name: "두고 가기" }).click();
      left++;
    }
  }
  if (!(await summary.isVisible()))
    await page.getByRole("button", { name: /내려가기/ }).click();
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(/가방에 넣었어요|캔 약초가 없어요/);
  await shot("3-summary");

  const c = (await admin.get(`characters/gather-${p}`)) as {
    bag?: { stacks?: Record<string, { itemId: string; quality: string }> };
    month: { fatigue?: Record<string, number> };
  };
  expect(c.month.fatigue?.["gathering"]).toBe(1);
  const stacks = Object.values(c.bag?.stacks ?? {});
  expect(dug + left).toBeGreaterThan(0);
  if (dug > 0) {
    expect(stacks.length).toBeGreaterThan(0);
    // 잎 뒤를 보고 조심히 캔 약초는 최상, 시간이 모자라 빨리 뜯었으면 중
    for (const s of stacks) expect(["최상", "중"]).toContain(s.quality);
  }
});
