import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import rawHunting from "../../data/defs/hunting.json" with { type: "json" };
import rawLimits from "../../data/defs/limits.json" with { type: "json" };
import { emulatorAdminPort } from "../../src/data/emulator-admin";
import { selectEnv } from "../../src/data/env";
import { newCharacter } from "../../src/rules/character";
import { HuntingDefsSchema } from "../../src/schema/defs/hunting";
import { LimitsSchema } from "../../src/schema/defs/limits";

const shots =
  process.env["GARDEN_SHOTS"] ??
  join(import.meta.dirname, "..", "..", "test-results", "shots");
mkdirSync(shots, { recursive: true });
const admin = emulatorAdminPort(selectEnv("emulator", { isTest: true }));
const limits = LimitsSchema.parse(rawLimits);
const { rules } = HuntingDefsSchema.parse(rawHunting);

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
  // 멧돼지와 싸우게 될 수도 있어 검술을 조금
  character.mastery["sword"] = { value: 40, passed60: false, passed80: false };
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

/** 한 번 사냥: 처음 흔적과 짐승 메모로 짐작하며 따라가고, 보이면 가운데를 쏜다. 결과 제목을 돌려준다 */
async function huntOnce(
  page: Page,
  shot?: (name: string) => Promise<unknown>,
): Promise<string> {
  const result = page.getByRole("region", { name: "사냥 결과" });
  const forkPanel = page.getByRole("region", { name: "갈림길" });
  const guide: Record<string, string[]> = {};
  const known: string[] = [];
  let shotFork = false;
  for (let i = 0; i < 20 && !(await result.isVisible()); i++) {
    if (await forkPanel.isVisible()) {
      if (known.length === 0) {
        const start = /처음 발견한 흔적: ([^.]+)\./.exec(
          (await forkPanel.locator(".ht__known").textContent()) ?? "",
        )?.[1];
        if (start) known.push(start.trim());
        for (const line of await forkPanel
          .locator(".ht__guide li")
          .allTextContents()) {
          const [name, tracks] = line.split(":");
          if (name && tracks)
            guide[name.trim()] = tracks.split("·").map((t) => t.trim());
        }
      }
      if (!shotFork && shot) {
        await shot("1-fork");
        shotFork = true;
      }
      const candidates = Object.values(guide).filter((tracks) =>
        known.every((k) => tracks.includes(k)),
      );
      const likely = new Set(candidates.flat());
      const buttons = forkPanel.getByRole("list").getByRole("button");
      const options: { index: number; label: string }[] = [];
      for (let b = 0; b < (await buttons.count()); b++) {
        if (await buttons.nth(b).isEnabled())
          options.push({
            index: b,
            label: (await buttons.nth(b).textContent()) ?? "",
          });
      }
      const trackOf = (label: string) => label.split("·")[1]?.trim() ?? "";
      const score = (label: string) =>
        (likely.has(trackOf(label)) ? 2 : 0) +
        (label.includes("바람을 등짐") ? 0 : 1);
      options.sort((a, b) => score(b.label) - score(a.label));
      const pick = options[0]!;
      const before = (await forkPanel.getByRole("heading").textContent()) ?? "";
      await buttons.nth(pick.index).click();
      const after = (await forkPanel.isVisible())
        ? ((await forkPanel.getByRole("heading").textContent()) ?? "")
        : "";
      if (after !== before) known.push(trackOf(pick.label));
      continue;
    }
    const aim = page.getByRole("region", { name: "조준" });
    if (await aim.isVisible()) {
      if (shot) await shot("2-aim");
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      await aim.getByRole("button", { name: "쏘기" }).click();
      const bar = page.getByRole("dialog", { name: "판정 바" });
      await expect(bar).toBeVisible();
      await page.clock.runFor(rules.bar.sweepMs / 2);
      await bar.dispatchEvent("pointerdown");
      await page.clock.resume();
    }
  }
  await expect(result).toBeVisible();
  if (await result.getByRole("button", { name: "맞서 싸우기" }).isVisible()) {
    await result.getByRole("button", { name: "맞서 싸우기" }).click();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.getByRole("button", { name: "자동" }).click();
    const battle = page.getByRole("region", { name: "전투 결과" });
    for (let i = 0; i < 60 && !(await battle.isVisible()); i++)
      await page.clock.runFor(1_000);
    await battle.getByRole("button", { name: "계속" }).click();
    await page.clock.resume();
  }
  await expect(result.getByRole("button", { name: "다시 사냥" })).toBeVisible();
  return (await result.getByRole("heading").textContent()) ?? "";
}

test("사냥: 흔적을 짐작해 따라가고, 다가가 쏘아 잡으면 가방에 들어간다", async ({
  page,
}, info) => {
  const p = info.project.name;
  const shot = (name: string) =>
    page.screenshot({
      path: join(shots, `hunting-${name}-${p}.png`),
      fullPage: true,
    });
  await page.clock.install();
  await enterWithCharacter(page, `사냥 ${p}`, `hunt-${p}`);
  await page.getByRole("button", { name: "사냥 (시험 환경)" }).click();
  await expect(page.getByRole("region", { name: "갈림길" })).toBeVisible();

  let caught = false;
  let tries = 0;
  for (; tries < 6 && !caught; tries++) {
    if (tries > 0)
      await page.getByRole("button", { name: "다시 사냥" }).click();
    const headline = await huntOnce(page, tries === 0 ? shot : undefined);
    caught = /잡았다|쓰러뜨렸다/.test(headline);
  }
  expect(caught).toBe(true);
  await shot("3-result");
  const c = (await admin.get(`characters/hunt-${p}`)) as {
    bag?: { stacks?: Record<string, unknown> };
    month: { fatigue?: Record<string, number> };
  };
  expect(Object.keys(c.bag?.stacks ?? {}).length).toBeGreaterThan(0);
  // 한 번 사냥할 때마다 피로가 하나씩
  expect(c.month.fatigue?.["hunting"]).toBe(tries);
});
