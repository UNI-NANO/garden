import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
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

/** 가짜 캐릭터(위치 없음 → 도서관 구역)를 만들어 계정에 잇는다 */
async function linkFakeCharacter(account: string, characterId: string, name: string) {
  const accounts = ((await admin.get("accounts")) ?? {}) as Record<string, { displayName?: string }>;
  const uid = Object.entries(accounts).find(([, a]) => a.displayName === account)?.[0];
  if (!uid) throw new Error("계정을 찾지 못했다");
  const character = newCharacter(limits, {
    owner: uid,
    name,
    gender: "여",
    origin: { realm: "제국", region: "황도", place: "장터 골목" },
    chosenTalents: ["agility", "sturdy", "intuition"],
    monthKey: "514-3",
    now: Date.now(),
    stage: "살아 있음",
  });
  await admin.update({ [`characters/${characterId}`]: character, [`accounts/${uid}/characterId`]: characterId });
}

test("구역 대화: 같은 구역에서 말·표정·귓속말·신고, 빨리 보내면 막힌다", async ({ browser }, info) => {
  const p = info.project.name;
  // 앞선 실행의 대화를 지운다 (가짜 데이터만 있는 에뮬레이터)
  await admin.update({ "chat/library": null, chatRate: null, chatReports: null });
  const options = info.project.use as BrowserContextOptions;
  const [ctxA, ctxB] = [await browser.newContext(options), await browser.newContext(options)];
  const [a, b] = [await ctxA.newPage(), await ctxB.newPage()];
  const nameA = `하린${p}`;
  const nameB = `도윤${p}`;
  await enter(a, `대화 A ${p}`);
  await linkFakeCharacter(`대화 A ${p}`, `chat-a-${p}`, nameA);
  await enter(b, `대화 B ${p}`);
  await linkFakeCharacter(`대화 B ${p}`, `chat-b-${p}`, nameB);

  const chatA = a.getByRole("region", { name: "구역 대화" });
  const chatB = b.getByRole("region", { name: "구역 대화" });
  await expect(chatA).toContainText("세계수 도서관");
  await expect(chatB).toContainText("세계수 도서관");

  const say = async (page: Page, text: string) => {
    const chat = page.getByRole("region", { name: "구역 대화" });
    await chat.getByLabel("할 말").fill(text);
    await chat.getByRole("button", { name: "보내기" }).click();
    await expect(chat.getByLabel("할 말")).toHaveValue("");
  };

  // 말 주고받기
  await say(a, "안녕하세요, 새로 왔어요.");
  await expect(chatB).toContainText(`${nameA}: 안녕하세요, 새로 왔어요.`);
  await say(b, "어서 와요.");
  await expect(chatA).toContainText(`${nameB}: 어서 와요.`);

  // 표정
  await say(a, "/표정 웃음");
  await expect(chatB).toContainText(`${nameA} (웃음)`);

  // 귓속말: B가 최근 말한 A에게. 둘만 본다
  await say(b, `/귓 ${nameA} 비밀이에요`);
  await expect(chatA).toContainText(`${nameB} → (귓속말) 비밀이에요`);
  await expect(chatB).toContainText(`→ ${nameA} (귓속말) 비밀이에요`);

  // 200자 넘으면 거절, 세기가 빨개진다
  await chatA.getByLabel("할 말").fill("가".repeat(limits.chat.maxLength + 1));
  await expect(chatA.getByText(`${limits.chat.maxLength + 1}/${limits.chat.maxLength}`)).toBeVisible();
  await chatA.getByRole("button", { name: "보내기" }).click();
  await expect(chatA).toContainText(`${limits.chat.maxLength}자까지`);

  // 신고: B가 A의 말을
  await chatB.getByRole("button", { name: `${nameA}의 말 신고` }).first().click();
  await expect(chatB).toContainText("신고했어요");
  const reports = Object.values(((await admin.get("chatReports")) ?? {}) as Record<string, { text: string }>);
  expect(reports.map((r) => r.text)).toContain("안녕하세요, 새로 왔어요.");
  await a.screenshot({ path: join(shots, `chat-1-talk-${p}.png`), fullPage: true });

  // 빨리 보내기: 10초 안에 burstLines줄(앞의 말·표정도 센다) → 막힘
  const submit = chatA.locator("button[type=submit]");
  let fast = 0;
  while (fast < limits.chat.burstLines && !(await submit.isDisabled())) await say(a, `빨리 ${++fast}`);
  await expect(chatA.getByRole("button", { name: /초 뒤에/ })).toBeDisabled();
  expect(fast).toBeLessThanOrEqual(limits.chat.burstLines);
  // 막힌 동안 친 말은 나가지 않는다
  await chatA.getByLabel("할 말").fill("막힌 말");
  await chatA.getByLabel("할 말").press("Enter");
  await expect(chatB).not.toContainText("막힌 말");
  await chatA.scrollIntoViewIfNeeded();
  await a.screenshot({ path: join(shots, `chat-2-muted-${p}.png`), fullPage: true });

  await ctxA.close();
  await ctxB.close();
});
