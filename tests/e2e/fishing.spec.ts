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

/** 물가에서 누르기 시작 / 떼기 (화면 아무 데나) */
async function down(page: Page) {
  const box = await page.locator(".fs__surface").boundingBox();
  if (!box) throw new Error("누를 곳이 없다");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

test("낚시: 던지고, 톡톡은 참고, 잠기면 채고, 줄을 아끼며 감아 낚는다", async ({
  page,
}, info) => {
  const p = info.project.name;
  const shot = (name: string) =>
    page.screenshot({
      path: join(shots, `fishing-${name}-${p}.png`),
      fullPage: true,
    });
  await page.clock.install();
  await enterWithCharacter(page, `낚시 A ${p}`, `fish-a-${p}`);
  await page.getByRole("button", { name: "낚시 (시험 환경)" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("누르고 있다가 떼면 던져요");
  await shot("1-ready");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));

  // 짧게 눌러 얕은 곳으로
  await down(page);
  await page.clock.runFor(250);
  await expect(page.getByRole("meter", { name: "던질 힘" })).toBeVisible();
  await page.mouse.up();
  await page.clock.runFor(100);
  await expect(status).toContainText(/찌를 지켜본다|톡톡/);
  await shot("2-wait");

  // 찌가 잠길 때까지 기다린다 (톡톡에는 누르지 않는다)
  for (
    let i = 0;
    i < 120 && !(await status.textContent())?.includes("찌가 잠겼다");
    i++
  )
    await page.clock.runFor(100);
  await expect(status).toContainText("찌가 잠겼다");
  await shot("3-bite");
  await down(page);
  await page.clock.runFor(100);
  await expect(page.getByRole("meter", { name: "줄 팽팽함" })).toBeVisible();

  // 씨름: 물살·차고 나감이 보이거나 줄이 팽팽하면 풀고, 아니면 감는다
  const tension = page.getByRole("meter", { name: "줄 팽팽함" });
  const result = page.getByRole("region", { name: "낚시 결과" });
  let reeling = true;
  let shotFight = false;
  for (let i = 0; i < 400 && !(await result.isVisible()); i++) {
    const text = (await status.textContent()) ?? "";
    const tight =
      Number(
        (await tension.getAttribute("aria-valuenow").catch(() => "0")) ?? "0",
      ) > 70;
    const want =
      !text.includes("물살") && !text.includes("차고 나간다") && !tight;
    if (want !== reeling) {
      if (want) await page.mouse.down();
      else await page.mouse.up();
      reeling = want;
    }
    if (!shotFight && i === 10) {
      await shot("4-fight");
      shotFight = true;
    }
    await page.clock.runFor(100);
  }
  if (reeling) await page.mouse.up();
  await expect(result).toBeVisible();
  await page.clock.runFor(1000);
  await expect(result).toContainText("cm");
  await expect(result).toContainText("품질");
  await shot("5-caught");

  const c = (await admin.get(`characters/fish-a-${p}`)) as {
    bag?: { stacks?: Record<string, { itemId: string }> };
    month: { fatigue?: Record<string, number> };
  };
  expect(Object.values(c.bag?.stacks ?? {})).toHaveLength(1);
  expect(c.month.fatigue?.["fishing"]).toBe(1);
});

test("낚시: 찌가 잠기기 전에 채면 놓친다 (피로는 오른다)", async ({
  page,
}, info) => {
  const p = info.project.name;
  await page.clock.install();
  await enterWithCharacter(page, `낚시 B ${p}`, `fish-b-${p}`);
  await page.getByRole("button", { name: "낚시 (시험 환경)" }).click();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await down(page);
  await page.clock.runFor(300);
  await page.mouse.up();
  await page.clock.runFor(200);
  await down(page);
  await page.mouse.up();
  await page.clock.runFor(200);
  const result = page.getByRole("region", { name: "낚시 결과" });
  await expect(result).toContainText("놓쳤다");
  await expect(result).toContainText("잠기기 전에 채었다");
  await expect(
    result.getByRole("button", { name: "다시 던지기" }),
  ).toBeEnabled();
  expect(await admin.get(`characters/fish-b-${p}/month/fatigue/fishing`)).toBe(
    1,
  );
});
