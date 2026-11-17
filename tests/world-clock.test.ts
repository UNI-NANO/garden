import { describe, expect, it } from "vitest";
import rawLimits from "../data/defs/limits.json";
import {
  advanceMonth,
  dateKeyAt,
  initialClock,
  mainActionsLeft,
  missingDays,
  monthKeyOf,
  nextDateKey,
  rolloverMonth,
  spendAction,
  yearEndAge,
} from "../src/rules/world-clock";
import type { Character } from "../src/schema/character";
import { LimitsSchema } from "../src/schema/defs/limits";

const limits = LimitsSchema.parse(rawLimits);
const month = (over: Partial<Character["month"]> = {}): Character["month"] => ({
  key: "514-3",
  mainActions: 4,
  minorActions: 2,
  savedActions: 0,
  career: 1,
  learnCounts: { sword: 2 },
  combatMasteryGained: { sword: 1 },
  fatigue: { 던전: 1 },
  ...over,
});
const clock = (over = {}) => ({ year: 514, monthIndex: 3, computing: false, ...over });

describe("날짜 키", () => {
  it("하루 경계는 한국 시간 자정 (UTC 15:00)", () => {
    const at = (iso: string) => dateKeyAt(Date.parse(iso), limits.clock.utcOffsetHours);
    expect(at("2026-11-30T14:59:59Z")).toBe("2026-11-30");
    expect(at("2026-11-30T15:00:00Z")).toBe("2026-12-01");
  });
  it("빠진 날을 오래된 것부터, 이미 했으면 없음", () => {
    expect(nextDateKey("2026-12-31")).toBe("2027-01-01");
    expect(missingDays("2026-11-29", "2026-12-02")).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(missingDays("2026-12-02", "2026-12-02")).toEqual([]);
    expect(missingDays("2026-12-03", "2026-12-02")).toEqual([]);
  });
});

describe("달력", () => {
  it("처음 세계: 성력 514년 첫 달, 오늘까지 처리한 것으로", () => {
    expect(initialClock(limits, Date.parse("2026-11-17T03:00:00Z"))).toEqual({ year: 514, monthIndex: 0, lastDateKey: "2026-11-17", computing: false });
  });
  it("10 다음은 이름 없는 다섯 날(한 해 정리), 그다음은 새해", () => {
    expect(advanceMonth({ year: 514, monthIndex: 3 })).toEqual({ year: 514, monthIndex: 4, yearEnd: false });
    expect(advanceMonth({ year: 514, monthIndex: 10 })).toEqual({ year: 514, monthIndex: 11, yearEnd: true });
    expect(advanceMonth({ year: 514, monthIndex: 11 })).toEqual({ year: 515, monthIndex: 0, yearEnd: false });
    expect(monthKeyOf({ year: 514, monthIndex: 11 })).toBe("514-11");
  });
  it("한 해 정리: 나이 +1, 150에서 멈춤", () => {
    expect([yearEndAge(17), yearEndAge(150)]).toEqual([18, 150]);
  });
});

describe("캐릭터 달 넘어감", () => {
  it("남은 주 행동은 저장, 작은 행동은 버리고, 이번 달 값은 새로", () => {
    const { month: next, auto, changed } = rolloverMonth(month({ mainActions: 3, minorActions: 1, savedActions: 0 }), "514-4", limits, false);
    expect(changed).toBe(true);
    expect(next).toEqual({ key: "514-4", mainActions: 4, minorActions: 2, savedActions: 3, career: 0, learnCounts: {}, combatMasteryGained: {}, fatigue: {} });
    expect(auto).toEqual({ work: 0, rest: 0 });
  });
  it("저장 행동 4를 넘는 몫은 자동 처리: 일터가 있으면 일하기부터 번갈아, 없으면 쉬기", () => {
    const full = month({ mainActions: 4, savedActions: 3 });
    expect(rolloverMonth(full, "514-4", limits, true)).toMatchObject({ month: { savedActions: 4 }, auto: { work: 2, rest: 1 } });
    expect(rolloverMonth(full, "514-4", limits, false)).toMatchObject({ month: { savedActions: 4 }, auto: { work: 0, rest: 3 } });
    expect(rolloverMonth(month({ mainActions: 1, savedActions: 4 }), "514-4", limits, true).auto).toEqual({ work: 1, rest: 0 });
  });
  it("며칠 안 들어온 캐릭터: 매일 넘어가며 저장 4 + 자동 처리가 쌓인다", () => {
    let m = month({ mainActions: 4, savedActions: 0 });
    const autos = [];
    for (const key of ["514-4", "514-5", "514-6"]) {
      const r = rolloverMonth(m, key, limits, false);
      m = r.month;
      autos.push(r.auto.rest);
    }
    expect(m.savedActions).toBe(4);
    expect(autos).toEqual([0, 4, 4]);
  });
  it("이미 그 달이면 아무것도 하지 않는다 (같은 날을 두 번 처리해도 같다)", () => {
    const already = month({ key: "514-4", mainActions: 1 });
    expect(rolloverMonth(already, "514-4", limits, true)).toEqual({ month: already, auto: { work: 0, rest: 0 }, changed: false });
  });
});

describe("행동 쓰기", () => {
  it("주 행동은 저장 행동부터, 다 쓰면 이번 달 몫", () => {
    let m = month({ savedActions: 1, mainActions: 1 });
    const first = spendAction(m, clock(), "514-3", "주 행동");
    expect(first).toMatchObject({ ok: true, used: { saved: 1, main: 0 }, month: { savedActions: 0, mainActions: 1 } });
    if (!first.ok) throw new Error();
    m = first.month;
    const second = spendAction(m, clock(), "514-3", "주 행동");
    expect(second).toMatchObject({ ok: true, used: { saved: 0, main: 1 }, month: { savedActions: 0, mainActions: 0 } });
    if (!second.ok) throw new Error();
    expect(spendAction(second.month, clock(), "514-3", "주 행동")).toEqual({ ok: false, reason: "행동이 없음" });
    expect(mainActionsLeft(month({ savedActions: 2, mainActions: 3 }))).toBe(5);
  });
  it("작은 행동은 따로", () => {
    expect(spendAction(month({ minorActions: 1 }), clock(), "514-3", "작은 행동")).toMatchObject({ ok: true, used: { minor: 1 }, month: { minorActions: 0, mainActions: 4 } });
    expect(spendAction(month({ minorActions: 0 }), clock(), "514-3", "작은 행동")).toEqual({ ok: false, reason: "행동이 없음" });
  });
  it("계산 중, 달이 다름, 이름 없는 다섯 날이면 거절", () => {
    expect(spendAction(month(), clock({ computing: true }), "514-3", "주 행동")).toEqual({ ok: false, reason: "계산 중" });
    // 달이 바뀌기 직전에 보낸 요청이 바뀐 뒤 도착
    expect(spendAction(month(), clock({ monthIndex: 4 }), "514-3", "주 행동")).toEqual({ ok: false, reason: "달이 다름" });
    // 캐릭터가 아직 넘어가지 않았음
    expect(spendAction(month({ key: "514-2" }), clock(), "514-3", "주 행동")).toEqual({ ok: false, reason: "달이 다름" });
    expect(spendAction(month({ key: "514-11" }), clock({ monthIndex: 11 }), "514-11", "주 행동")).toEqual({ ok: false, reason: "이름 없는 다섯 날" });
  });
});
