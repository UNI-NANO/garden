import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDaily } from "../../src/data/daily";
import type { AdminPort } from "../../src/data/migrate-write";
import { characterSchema } from "../../src/schema/character";
import { WorldClockSchema } from "../../src/schema/world";
import { limits, makeCharacter } from "../helpers/fake-character";
import { CLOCK, GM, OWNER, readAll, startTestEnv } from "./helpers";

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));

/** 하루 계산이 쓰는 관리자 창구 (보안 규칙을 건너뛴다) */
const admin: AdminPort = {
  get: async (path) => {
    let value: unknown;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      value = (await context.database().ref(path || "/").get()).val();
    });
    return value;
  },
  update: async (updates) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.database().ref().update(updates);
    });
  },
};

/** 한국 시간 그날 낮 */
const at = (dateKey: string) => Date.parse(`${dateKey}T03:00:00Z`);
const clock = async () => WorldClockSchema.parse(await admin.get("world/clock"));
const character = async (id: string) => characterSchema(limits).parse(await admin.get(`characters/${id}`));

/** 처음 상태: 세계 514-3(2026-11-17까지 처리), 캐릭터 둘 */
async function seedWorld(clockOver = {}) {
  const worker = makeCharacter(OWNER);
  worker.month = { ...worker.month, key: "514-3", mainActions: 4, minorActions: 1, savedActions: 2, career: 2 };
  worker.profile = { ...worker.profile, age: 17, job: { name: "견습 대장장이", stage: "견습", workplace: "카른브룸 대장간" } };
  const idle = makeCharacter("uid-idle");
  idle.month = { ...idle.month, key: "514-3", mainActions: 4, savedActions: 4 };
  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.database().ref().set({ gm: { [GM]: true }, characters: { worker, idle }, world: { clock: { ...CLOCK, ...clockOver } } });
  });
}

describe("하루 계산", () => {
  it("세계 시계가 없으면 처음 값으로 만든다", async () => {
    await testEnv.clearDatabase();
    const report = await runDaily(admin, { limits, now: at("2026-11-20") });
    expect(report.days).toEqual([]);
    expect(await clock()).toEqual({ year: 514, monthIndex: 0, monthKey: "514-0", lastDateKey: "2026-11-20", computing: false });
  });

  it("하루: 세계의 달 +1, 모든 캐릭터 달 넘어감, 날짜 기록, 계산 중 끔, 실행 기록", async () => {
    await seedWorld();
    const backups: string[] = [];
    const report = await runDaily(admin, {
      limits,
      now: at("2026-11-18"),
      backup: async (dateKey, data) => {
        expect(data).toHaveProperty("characters");
        backups.push(dateKey);
        return `backups/${dateKey}.json`;
      },
    });
    expect(report.days).toEqual(["2026-11-18"]);
    expect(backups).toEqual(["2026-11-18"]);
    expect(await clock()).toEqual({ year: 514, monthIndex: 4, monthKey: "514-4", lastDateKey: "2026-11-18", computing: false });

    const worker = await character("worker");
    // 남은 주 4 + 저장 2 = 6 → 저장 4, 넘친 2는 일터가 있어 일하기·쉬기
    expect(worker.month).toEqual({ key: "514-4", mainActions: 4, minorActions: 2, savedActions: 4, career: 0, learnCounts: {}, combatMasteryGained: {}, fatigue: {} });
    expect(worker.life.at(-1)).toEqual({ kind: "달", when: "514-3", text: "저장 행동이 넘쳐 자동 처리: 일하기 1번, 쉬기 1번" });
    expect((await character("idle")).life.at(-1)?.text).toBe("저장 행동이 넘쳐 자동 처리: 쉬기 4번");

    const runs = Object.values((await admin.get("world/runs")) as Record<string, { ok: boolean; days: string[] }>);
    expect(runs).toEqual([expect.objectContaining({ ok: true, days: ["2026-11-18"] })]);
  });

  it("사흘 밀렸으면 하루씩 차례로 메운다, 백업은 첫날에 한 번", async () => {
    await seedWorld();
    let backups = 0;
    const report = await runDaily(admin, { limits, now: at("2026-11-20"), backup: async () => `b${++backups}` });
    expect(report.days).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(backups).toBe(1);
    expect((await clock()).monthKey).toBe("514-6");
    expect((await character("worker")).month.key).toBe("514-6");
  });

  it("같은 날 두 번 돌려도 결과가 같다", async () => {
    await seedWorld();
    await runDaily(admin, { limits, now: at("2026-11-18") });
    const once = { clock: await clock(), worker: await character("worker") };
    const again = await runDaily(admin, { limits, now: at("2026-11-18") + 3_600_000 });
    expect(again.days).toEqual([]);
    expect({ clock: await clock(), worker: await character("worker") }).toEqual(once);
  });

  it("이름 없는 다섯 날이 되는 날은 한 해 정리(나이 +1), 그다음 날은 새해", async () => {
    await seedWorld({ monthIndex: 10, monthKey: "514-10" });
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.database().ref().update({ "characters/worker/month/key": "514-10", "characters/idle/month/key": "514-10" });
    });
    await runDaily(admin, { limits, now: at("2026-11-18") });
    expect((await clock()).monthKey).toBe("514-11");
    expect((await character("worker")).profile.age).toBe(18);
    await runDaily(admin, { limits, now: at("2026-11-19") });
    expect((await clock()).monthKey).toBe("515-0");
    expect((await character("worker")).profile.age).toBe(18);
  });

  it("도중에 실패하면 계산 중을 켠 채 두고, 다음 실행이 끝난 단계를 건너뛰고 이어서 한다", async () => {
    // 비교용: 실패 없이 이틀
    await seedWorld();
    await runDaily(admin, { limits, now: at("2026-11-19") });
    const clean = { clock: await clock(), worker: await character("worker"), idle: await character("idle") };

    await seedWorld();
    // 둘째 날의 달 넘어감 쓰기에서 실패시킨다
    let monthWrites = 0;
    const flaky: AdminPort = {
      get: admin.get,
      update: async (updates) => {
        if ("world/clock/monthKey" in updates && ++monthWrites === 2) throw new Error("연결이 끊겼다");
        await admin.update(updates);
      },
    };
    await expect(runDaily(flaky, { limits, now: at("2026-11-19") })).rejects.toThrow("연결이 끊겼다");
    const stuck = await clock();
    expect(stuck).toMatchObject({ computing: true, monthKey: "514-4", lastDateKey: "2026-11-18", progress: { dateKey: "2026-11-19", done: ["백업"] } });
    const failed = Object.values((await admin.get("world/runs")) as Record<string, { ok: boolean; error?: string }>);
    expect(failed).toEqual([expect.objectContaining({ ok: false, error: "연결이 끊겼다" })]);

    await runDaily(admin, { limits, now: at("2026-11-19") });
    expect({ clock: await clock(), worker: await character("worker"), idle: await character("idle") }).toEqual(clean);
  });

  it("관리자만 쓴다: 주인은 세계 시계와 실행 기록을 쓰지 못한다", async () => {
    await seedWorld();
    const db = testEnv.authenticatedContext(OWNER).database();
    await expect(db.ref("world/clock/monthIndex").set(9)).rejects.toThrow();
    await expect(db.ref("world/runs/x").set({ ok: true })).rejects.toThrow();
    expect(await readAll(testEnv, "world/clock/monthIndex")).toBe(3);
  });
});
