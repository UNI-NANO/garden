import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCondition, parseScriptBook } from "../src/rules/scene/parse";
import { advance, battleOutcome, choose, playThrough, renderText, startScene, type Frame, type SceneContext } from "../src/rules/scene/run";

const ctx = (over: Partial<SceneContext> = {}): SceneContext => ({
  name: "아린",
  vars: {},
  marks: new Set(),
  worldMarks: new Set(),
  clues: new Set(),
  quests: new Set(),
  talents: new Set(),
  numbers: {},
  ...over,
});
/** 시험용 대본 조각을 한 장면으로 */
const one = (body: string) => {
  const parsed = parseScriptBook("```\n# 장면: t\n배경: 홀\n" + body.trim() + "\n```\n");
  return { scene: parsed.scenes[0]!, issues: parsed.issues.map((i) => i.message) };
};
const lines = (frames: Frame[]) => frames.flatMap((f) => (f.kind === "line" ? [f.segments.map((s) => s.text).join("")] : []));

describe("대본 파서", () => {
  it("지금 대본집의 모든 장면이 형식대로 읽힌다", () => {
    const { scenes, issues } = parseScriptBook(readFileSync(join(import.meta.dirname, "..", "docs", "대본집.md"), "utf8"));
    expect(issues).toEqual([]);
    expect(scenes.length).toBeGreaterThanOrEqual(186);
    expect(scenes.find((s) => s.id === "intro_new_shelf")).toMatchObject({ background: "도서관_홀_밤", music: "책장의_숨" });
    // 한 코드 블록에 여러 장면이 있는 성장기도 장면마다 따로
    expect(scenes.filter((s) => s.id.startsWith("grow_hwangdo_")).length).toBe(5);
  });
  it("조건", () => {
    expect(parseCondition("표시:다섯 날의 아이")).toEqual({ kind: "표시", key: "다섯 날의 아이" });
    expect(parseCondition("집안:군인·기사")).toEqual({ kind: "집안", key: "군인·기사" });
    expect(parseCondition("학식 60")).toEqual({ kind: "수치", name: "학식", atLeast: 60 });
    expect(parseCondition("아무 말")).toBeUndefined();
  });
  it("문제를 줄 번호와 함께 잡는다", () => {
    expect(one("서술: 시작\n[합류 없음]\n[끝]").issues).toContain("없는 갈래로 합류: 없음");
    expect(one("> 선택\n  - 가자 → 저기\n[끝]").issues).toContain("없는 갈래로 가는 선택지: 저기");
    expect(one("서술: 끝이 없다").issues).toEqual(expect.arrayContaining(["[끝]이 없다"]));
    expect(one("[날기 하늘]\n[끝]").issues).toContain("모르는 명령: [날기 하늘]");
    expect(one("[만약 표시:x]\n서술: a\n[끝]").issues).toContain("[만약]이 [만약 끝]으로 닫히지 않았다");
    expect(one("[등장 사서 위쪽 기본]\n[끝]").issues).toContain("자리는 왼쪽·가운데·오른쪽·뒷줄 (지금 위쪽)");
    expect(one("사서(울음): 흑\n[끝]").issues).toContain("없는 표정: 울음");
    expect(one("[친밀도 사서 열]\n[끝]").issues).toContain("[친밀도]의 값은 +n 또는 -n");
    expect(one("[능력치 근력 +1]\n[끝]").issues).toContain("없는 능력치: 근력");
    expect(one("[이어서 없는장면]").issues).toContain("없는 장면으로 이어 간다: 없는장면");
    expect(one("> 선택\n  - a → 가\n@가\n서술: a\n@나\n서술: b\n[끝]").issues).toContain("앞 줄에서 @나로 그냥 흘러 들어간다 ([합류 나]나 [끝]으로 맺는다)");
    const twice = parseScriptBook("```\n# 장면: x\n[끝]\n```\n```\n# 장면: x\n[끝]\n```\n");
    expect(twice.issues[0]?.message).toMatch(/같은 장면 ID/);
  });
});

describe("장면 실행기", () => {
  const book = parseScriptBook(readFileSync(join(import.meta.dirname, "..", "docs", "대본집.md"), "utf8")).scenes;
  const scene = (id: string) => book.find((s) => s.id === id)!;

  it("「새 책장」: 선택한 갈래로 가고, 합류하고, 결과는 끝에서 한 번에", () => {
    const run = playThrough(scene("intro_new_shelf"), ctx(), { choices: [0] });
    const said = lines(run.frames);
    expect(said[0]).toBe("종이 냄새가 먼저 돌아왔다.");
    expect(said).toContain("깨셨군요, 아린.");
    expect(said).toContain("책들은 가끔 이래요. 자기 자리가 마음에 들지 않으면.");
    expect(said).not.toContain("등에 적힌 이름은 당신의 것이다.");
    expect(run.frames.some((f) => f.kind === "pause" && f.cmd === "일생")).toBe(true);
    expect(run.end.results).toEqual([
      { cmd: "표시", args: ["새_책장을_봄"] },
      { cmd: "퀘스트", args: ["가문_1막", "진행"] },
    ]);
    // 결과가 나오기 전 프레임에는 아무 결과도 없다 (중간에 닫으면 적용할 것이 없다)
    expect(run.frames.filter((f) => f.kind === "end")).toHaveLength(1);
  });

  it("[만약 표시]는 캐릭터의 표시를 본다", () => {
    const without = lines(playThrough(scene("intro_new_shelf"), ctx(), { choices: [1] }).frames);
    const withMark = lines(playThrough(scene("intro_new_shelf"), ctx({ marks: new Set(["가문_퀘스트_있음"]), vars: { 가문_퀘스트_이름: "라인펠트의 맹세" } }), { choices: [1] }).frames);
    expect(without).not.toContain("그리고 하나 더.");
    expect(withMark).toContain("그리고 하나 더.");
    expect(withMark).toContain("라인펠트의 맹세");
  });

  it("무대: 등장·퇴장·표정·배경·암전, 한때의 연출은 그 프레임에", () => {
    const { scene: s } = one(`
[암전]
[등장 사서 가운데 기본]
서술: 하나
[밝아짐]
[표정 사서 웃음]
[흔들림 강]
[효과음 문_열림]
사서(웃음): 둘
배경: 서가
[퇴장 사서]
서술: 셋
[끝]`);
    const frames = playThrough(s, ctx()).frames;
    expect(frames[0]).toMatchObject({ kind: "line", stage: { background: "홀", dark: true, actors: { 사서: { slot: "가운데", expr: "기본" } } }, effects: [] });
    expect(frames[1]).toMatchObject({ stage: { dark: false, actors: { 사서: { expr: "웃음" } } }, effects: [{ cmd: "흔들림", arg: "강" }, { cmd: "효과음", arg: "문_열림" }] });
    expect(frames[2]).toMatchObject({ stage: { background: "서가", actors: {} }, effects: [] });
  });

  it("조건 선택지는 조건을 채울 때만 보인다", () => {
    const { scene: s } = one(`
> 선택
  - 그냥 → 가
  - 아는 척 → 나 ?학식 60
  - 표시 → 나 ?표시:학당을_다님
@가
[끝]
@나
[끝]`);
    const first = (c: SceneContext) => advance(s, startScene(s), c).frame;
    expect(first(ctx())).toMatchObject({ kind: "choice", options: [{ index: 0, text: "그냥" }] });
    expect(first(ctx({ numbers: { 학식: 60 }, marks: new Set(["학당을_다님"]) }))).toMatchObject({ options: [{ text: "그냥" }, { text: "아는 척" }, { text: "표시" }] });
  });

  it("같은 장면에서 먼저 얻은 표시는 뒤 줄의 조건에 걸린다", () => {
    const { scene: s } = one(`
[표시 들음]
[만약 표시:들음]
서술: 안다
[아니면]
서술: 모른다
[만약 끝]
[끝]`);
    expect(lines(playThrough(s, ctx()).frames)).toEqual(["안다"]);
  });

  it("장면 안 전투: 결과에 따라 갈래로, 생포 갈래가 없으면 이김으로", () => {
    const { scene: s } = one(`
[전투 ch1_test → 이김:이김 짐:짐]
@이김
서술: 이겼다
[세계표시 이김]
[끝]
@짐
서술: 졌다
[끝]`);
    expect(lines(playThrough(s, ctx(), { battles: ["짐"] }).frames)).toEqual(["졌다"]);
    expect(playThrough(s, ctx(), { battles: ["생포"] }).end.results).toEqual([{ cmd: "세계표시", args: ["이김"] }]);
    const cursor = advance(s, startScene(s), ctx()).cursor;
    expect(() => advance(s, cursor, ctx())).toThrow("기다리는 중");
    expect(() => choose(s, cursor, 0)).toThrow("선택을 기다리는 중이 아니다");
    expect(battleOutcome(s, cursor, "이김").waiting).toBeUndefined();
  });

  it("[이어서]: 끝내고 다음 장면", () => {
    const end = playThrough(scene("ch1_raid_enter"), ctx(), { battles: ["이김"] }).end;
    expect(end.next).toBe("ch1_raid_success");
  });

  it("바꿔 넣기와 글씨 연출", () => {
    expect(renderText("{나}와 {친구}, {모름}", ctx({ vars: { 친구: "벤" } }))).toEqual([{ text: "아린와 벤, {모름}" }]);
    expect(renderText("앞〔빨강〕붉게〔/〕뒤〔작게〕작게〔/〕", ctx())).toEqual([{ text: "앞" }, { text: "붉게", style: "빨강" }, { text: "뒤" }, { text: "작게", style: "작게" }]);
    const { scene: s } = one("{친구}(작게): 속삭임\n[끝]");
    expect(playThrough(s, ctx({ vars: { 친구: "벤" } })).frames[0]).toMatchObject({ speaker: "벤", expr: "기본", small: true });
  });

  it("같은 입력이면 같은 결과, 모든 장면이 모든 첫 선택지로 끝까지 돈다", () => {
    for (const s of book) {
      for (const pick of [0, 1, 2]) {
        const a = playThrough(s, ctx(), { choices: [pick, pick, pick, pick], battles: ["짐", "짐"] });
        const b = playThrough(s, ctx(), { choices: [pick, pick, pick, pick], battles: ["짐", "짐"] });
        expect(a).toEqual(b);
      }
    }
  });
});
