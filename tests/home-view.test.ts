import { describe, expect, it } from "vitest";
import { monthLabel, parseMonthKey } from "../src/rules/calendar";
import { buildHomeView } from "../src/rules/home-view";
import { makeCharacter } from "./helpers/fake-character";

describe("달 표시", () => {
  it("달 순번을 차례 이름으로", () => {
    expect(monthLabel("514-0")).toBe("성력 514년 · 첫째 달");
    expect(monthLabel("514-2")).toBe("성력 514년 · 셋째 달");
    expect(monthLabel("514-10")).toBe("성력 514년 · 열한째 달");
    expect(monthLabel("514-11")).toBe("성력 514년 · 이름 없는 다섯 날");
  });
  it("틀린 값은 알 수 없는 달", () => {
    expect(monthLabel("514-12")).toBe("알 수 없는 달");
    expect(monthLabel("")).toBe("알 수 없는 달");
    expect(parseMonthKey("514-3")).toEqual({ year: 514, index: 3 });
  });
});

describe("도서관 홈이 보여줄 값", () => {
  it("새 캐릭터", () => {
    const view = buildHomeView(makeCharacter());
    expect(view).toMatchObject({
      badge: undefined,
      nameLines: ["시험", "캐릭터"],
      originLine: "황도 출신 · 0세",
      jobLine: undefined,
      location: undefined,
      month: "성력 514년 · 넷째 달",
      actions: "주 행동 4 · 작은 행동 2",
      savedActions: undefined,
      life: [],
      stageNote: undefined,
    });
  });
  it("직업·위치·저장 행동·창립 표시", () => {
    const c = makeCharacter();
    c.meta.founder = true;
    c.profile.age = 15;
    c.profile.job = { name: "카르텔 조직원", stage: "시카리오" };
    c.profile.location = { region: "소프레고", place: "로스 알토스의 언덕" };
    c.month.savedActions = 3;
    expect(buildHomeView(c)).toMatchObject({
      badge: "창립",
      originLine: "황도 출신 · 15세",
      jobLine: "카르텔 조직원 · 시카리오",
      location: "소프레고 — 로스 알토스의 언덕",
      savedActions: "저장 행동 3",
    });
  });
  it("출신이 비어 있으면 나이만, 지역과 장소가 같으면 한 번만, 단계가 비면 직업만", () => {
    const c = makeCharacter();
    delete c.profile.origin;
    c.profile.job = { name: "사제", stage: "" };
    c.profile.location = { region: "황도", place: "황도" };
    expect(buildHomeView(c)).toMatchObject({ originLine: "0세", jobLine: "사제", location: "황도" });
  });
  it("일생 기록은 최근 것이 위로, 때는 달 이름으로", () => {
    const c = makeCharacter();
    c.life = [
      { kind: "달", when: "513-8", text: "일하기 보통" },
      { kind: "전투", text: "「대련」 — 승리" },
    ];
    expect(buildHomeView(c).life).toEqual([
      { when: undefined, kind: "전투", text: "「대련」 — 승리" },
      { when: "성력 513년 · 아홉째 달", kind: "달", text: "일하기 보통" },
    ]);
  });
  it("살아 있지 않으면 그 상태를 알린다", () => {
    const c = makeCharacter();
    c.meta.stage = "죽음";
    expect(buildHomeView(c).stageNote).toBe("죽음");
  });
});
