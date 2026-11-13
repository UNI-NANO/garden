import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import rawItems from "../../data/defs/items.json" with { type: "json" };
import rawLimits from "../../data/defs/limits.json" with { type: "json" };
import rawMigration from "../../data/defs/migration.json" with { type: "json" };
import rawTalents from "../../data/defs/talents.json" with { type: "json" };
import { emulatorAdminPort } from "../../src/data/emulator-admin";
import { selectEnv } from "../../src/data/env";
import { linkCharacter } from "../../src/data/link-character";
import { writeMigrated } from "../../src/data/migrate-write";
import { convertCharacter } from "../../src/rules/migrate/convert";
import { readOldData } from "../../src/rules/migrate/read-old";
import { ItemListSchema } from "../../src/schema/defs/item";
import { LimitsSchema } from "../../src/schema/defs/limits";
import { MigrationSchema } from "../../src/schema/defs/migration";
import { TalentListSchema } from "../../src/schema/defs/talent";
import { sampleChars, sampleExport } from "../fixtures/old-sample";

/** 화면 캡처를 둘 곳. 저장소에는 넣지 않는다 */
const shots = process.env["GARDEN_SHOTS"] ?? join(import.meta.dirname, "..", "..", "test-results", "shots");
mkdirSync(shots, { recursive: true });

const env = selectEnv("emulator", { isTest: true });
const admin = emulatorAdminPort(env);
const limits = LimitsSchema.parse(rawLimits);
const dbUrl = `http://${env.emulator?.host}:${env.emulator?.databasePort}/.json?ns=${env.firebase.projectId}-default-rtdb`;

/** 가짜 견본에서 만든 캐릭터 하나 (실제 데이터가 아니다) */
function sampleCharacter() {
  const old = readOldData(sampleExport(), sampleChars());
  const bundle = old.characters.find((c) => c.player === "가람");
  if (!bundle || !old.calendar) throw new Error("견본을 읽지 못했다");
  return convertCharacter(bundle, {
    migration: MigrationSchema.parse(rawMigration),
    limits,
    talents: TalentListSchema.parse(rawTalents).talents,
    items: ItemListSchema.parse(rawItems).items,
    calendar: old.calendar,
    now: Date.now(),
    battles: old.battles,
    stories: old.stories,
  });
}

async function uidOf(displayName: string): Promise<string> {
  const accounts = ((await admin.get("accounts")) ?? {}) as Record<string, { displayName?: string }>;
  const found = Object.entries(accounts).find(([, account]) => account.displayName === displayName);
  if (!found) throw new Error(`계정을 찾지 못했다: ${displayName}`);
  return found[0];
}

async function enter(page: Page, name: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "도서관 입구" })).toBeVisible();
  await page.getByLabel("시험 계정 이름").fill(name);
  await page.getByRole("button", { name: "시험 계정으로 들어가기" }).click();
  await expect(page.getByRole("heading", { name: "세계수 도서관" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await fetch(dbUrl, { method: "DELETE", headers: { Authorization: "Bearer owner" } });
});

test("로그인부터 도서관 홈까지", async ({ page }, testInfo) => {
  const shot = (name: string) => page.screenshot({ path: join(shots, `${testInfo.project.name}-${name}.png`), fullPage: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // 1. 로그인 화면
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "저편의 정원" })).toBeVisible();
  await expect(page.getByRole("button", { name: "구글 계정으로 들어가기" })).toBeVisible();
  // 시작 문구가 남아 있지 않고, 화면이 한 장에 들어온다
  await expect(page.locator(".boot")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await shot("1-login");

  // 2. 처음 들어온 계정: 캐릭터가 없어 기다림
  await enter(page, "가람");
  await expect(page.getByText("사서가 열람증을 준비하고 있어요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "내 일생" })).toBeDisabled();
  await shot("2-waiting");

  // 3. GM이 캐릭터를 연결하면 창을 열어 둔 채로 열람증이 놓인다
  const sample = sampleCharacter();
  await writeMigrated(admin, env, limits, [sample]);
  expect(await linkCharacter(admin, await uidOf("가람"), sample.characterId)).toEqual({ ok: true });

  const card = page.getByRole("region", { name: "열람증" });
  await expect(card.getByText("아린")).toBeVisible();
  await expect(card.getByText("벨로")).toBeVisible();
  await expect(card.getByText("창립")).toBeVisible();
  await expect(card.getByText("기사 · 종자")).toBeVisible();
  await expect(card.getByText("북쪽 팔 — 어느 영주성")).toBeVisible();
  await expect(card.getByText("성력 514년 · 첫째 달")).toBeVisible();
  await expect(card.getByText("주 행동 4 · 작은 행동 2")).toBeVisible();
  await expect(page.getByText("깨셨군요. 오늘은 어디서부터 읽을까요.")).toBeVisible();
  // 아직 없는 것은 눌리지 않는다
  await expect(page.getByRole("button", { name: "열람실" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "월보" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "이어하기" })).toBeDisabled();
  // 숨은 것(비밀)은 화면에 없다
  await expect(page.getByText("원수의 친구")).toHaveCount(0);
  await shot("3-home");

  // 4. 내 일생
  await page.getByRole("button", { name: "내 일생" }).click();
  const life = page.getByRole("region", { name: "내 일생" });
  await expect(life.getByText("「훈련장 대련」 (북쪽 팔) — 승리")).toBeVisible();
  await expect(life.getByText("성력 513년 · 열째 달")).toBeVisible();
  await shot("4-life");
  await life.getByRole("button", { name: "덮기" }).click();
  await expect(card.getByText("아린")).toBeVisible();

  // 5. 누르는 것은 44px 이상 (모바일 규칙)
  for (const button of await page.getByRole("button").all()) {
    const box = await button.boundingBox();
    if (box) expect(box.height, await button.innerText()).toBeGreaterThanOrEqual(44);
  }
  // 가로로 넘치지 않는다
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // 6. 나가면 로그인 화면으로
  await page.getByRole("button", { name: "나가기" }).click();
  await expect(page.getByRole("heading", { name: "도서관 입구" })).toBeVisible();

  // 7. 다른 계정에는 그 캐릭터가 보이지 않는다
  await enter(page, "다른 사람");
  await expect(page.getByText("사서가 열람증을 준비하고 있어요.")).toBeVisible();
  await expect(page.getByText("아린")).toHaveCount(0);
  await page.getByRole("button", { name: "나가기" }).click();

  // 8. 저장된 값이 깨져도 화면은 멈추지 않고 안내를 띄우며, 오류가 기록된다
  await admin.update({ [`characters/${sample.characterId}/wallet`]: -5 });
  await enter(page, "가람");
  await expect(page.getByText("캐릭터 기록을 읽지 못했어요. GM에게 알려 주세요.")).toBeVisible();
  await shot("5-problem");
  await expect.poll(async () => Object.keys(((await admin.get("errors")) ?? {}) as object).length).toBeGreaterThan(0);
  // 값을 고치면 새로 고치지 않아도 돌아온다
  await admin.update({ [`characters/${sample.characterId}/wallet`]: 154 });
  await expect(card.getByText("아린")).toBeVisible();
  await page.getByRole("button", { name: "나가기" }).click();
  await expect(page.getByRole("heading", { name: "도서관 입구" })).toBeVisible();

  expect(pageErrors).toEqual([]);
});
