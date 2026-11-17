import type { BattleOutcome, Condition, Instr, PauseCommand, Result, Scene, StageCommand } from "./parse";

/**
 * 장면 실행기. 캐릭터 값으로 대본을 한 줄씩 나아가며, 화면에 보일 것(프레임)을 하나씩 내놓는다.
 * 결과 명령은 모아 두었다가 장면이 끝날 때 한 번에 내놓는다(중간에 닫으면 아무것도 적용되지 않는다).
 * 순수 함수다. 같은 대본, 같은 캐릭터 값, 같은 선택이면 같은 프레임과 결과가 나온다.
 */

/** 조건과 바꿔 넣기에 쓰는 캐릭터 값 */
export interface SceneContext {
  /** {나} */
  name: string;
  /** 그 밖의 바꿔 넣기 ({친구}, {연도}, {달}, {지역} …). 없으면 글 그대로 */
  vars: Readonly<Record<string, string>>;
  marks: ReadonlySet<string>;
  worldMarks: ReadonlySet<string>;
  clues: ReadonlySet<string>;
  /** 받은(시작한) 퀘스트 */
  quests: ReadonlySet<string>;
  /** 집안 (농가, 귀족, 군인·기사 …) */
  house?: string;
  talents: ReadonlySet<string>;
  /** 능력치·숙련도 이름 → 값 (조건 `학식 60` 등) */
  numbers: Readonly<Record<string, number>>;
}

export type TextStyle = "빨강" | "작게" | "흐리게" | "떨림";
export interface Segment {
  text: string;
  style?: TextStyle;
}

/** 무대: 배경과 서 있는 사람들 */
export interface Stage {
  background?: string;
  music?: string;
  actors: Record<string, { slot: string; expr: string }>;
  dark: boolean;
}

/** 이 프레임과 함께 일어나는 한때의 연출 */
export interface Effect {
  cmd: Extract<StageCommand, "흔들림" | "효과음" | "컷인" | "연출">;
  arg: string;
}

export type Frame =
  | { kind: "line"; speaker?: string; expr?: string; small?: true; segments: Segment[]; stage: Stage; effects: Effect[] }
  | { kind: "choice"; options: { index: number; text: string }[]; stage: Stage; effects: Effect[] }
  /** 장면 안의 전투. 끝나면 battleOutcome으로 결과를 넘긴다 */
  | { kind: "battle"; id: string; outcomes: BattleOutcome[]; stage: Stage; effects: Effect[] }
  /** 다른 화면 열기, GM 승인 기다리기, 일생 요약, 설명 카드. 닫히면 다시 advance */
  | { kind: "pause"; cmd: PauseCommand; arg: string; stage: Stage; effects: Effect[] }
  /** 끝. next가 있으면 그 장면을 이어 본다 */
  | { kind: "end"; results: Result[]; next?: string; stage: Stage; effects: Effect[] };

/** 무대·연출을 뺀 프레임 (갈래마다 따로) */
type FrameBody = Frame extends infer F ? (F extends Frame ? Omit<F, "stage" | "effects"> : never) : never;

export interface Cursor {
  pc: number;
  stage: Stage;
  results: Result[];
  /** 고른 선택지 (보이는 말) */
  choices: string[];
  /** 기다리는 입력: 선택지·전투 결과. 없으면 advance로 나아간다 */
  waiting?: { kind: "choice"; options: { text: string; target: string }[] } | { kind: "battle"; outcomes: Partial<Record<BattleOutcome, string>> };
  done: boolean;
}

export class SceneError extends Error {
  override name = "SceneError";
}

export function startScene(scene: Scene): Cursor {
  return {
    pc: 0,
    stage: { ...(scene.background !== undefined ? { background: scene.background } : {}), ...(scene.music !== undefined ? { music: scene.music } : {}), actors: {}, dark: false },
    results: [],
    choices: [],
    done: false,
  };
}

/** 장면 안에서 생긴 표시·단서도 조건에 넣는다 (결과는 끝에 적용되지만, 같은 장면의 뒤 줄은 그것을 안다) */
function holds(when: Condition, ctx: SceneContext, cursor: Cursor): boolean {
  const gained = (cmd: Result["cmd"], key: string) => cursor.results.some((r) => r.cmd === cmd && r.args[0] === key);
  switch (when.kind) {
    case "표시":
      return ctx.marks.has(when.key) || gained("표시", when.key);
    case "세계표시":
      return ctx.worldMarks.has(when.key) || gained("세계표시", when.key);
    case "단서":
      return ctx.clues.has(when.key) || gained("단서", when.key);
    case "퀘스트":
      return ctx.quests.has(when.key) || cursor.results.some((r) => r.cmd === "퀘스트" && r.args[0] === when.key);
    case "집안":
      return ctx.house === when.key;
    case "재능":
      return ctx.talents.has(when.key);
    case "수치":
      return (ctx.numbers[when.name] ?? 0) >= when.atLeast;
  }
}

/** {이름}을 바꿔 넣고, 〔빨강〕…〔/〕 같은 글씨 연출을 조각으로 나눈다 */
export function renderText(text: string, ctx: SceneContext): Segment[] {
  const replaced = text.replace(/\{([^{}]+)\}/g, (whole, key: string) => (key === "나" ? ctx.name : (ctx.vars[key] ?? whole)));
  const segments: Segment[] = [];
  const pattern = /〔(빨강|작게|흐리게|떨림)〕(.*?)〔\/〕/g;
  let at = 0;
  for (const match of replaced.matchAll(pattern)) {
    if (match.index > at) segments.push({ text: replaced.slice(at, match.index) });
    segments.push({ text: match[2]!, style: match[1] as TextStyle });
    at = match.index + match[0].length;
  }
  if (at < replaced.length) segments.push({ text: replaced.slice(at) });
  return segments;
}

/**
 * 다음 프레임까지 나아간다. 연출 명령은 무대에 반영하고, 결과 명령은 모은다.
 * 선택지·전투를 기다리는 중이면 오류 (choose·battleOutcome을 먼저).
 */
export function advance(scene: Scene, before: Cursor, ctx: SceneContext): { frame: Frame; cursor: Cursor } {
  if (before.done) throw new SceneError("이미 끝난 장면");
  if (before.waiting) throw new SceneError("선택이나 전투 결과를 기다리는 중");
  const cursor: Cursor = structuredClone(before);
  const effects: Effect[] = [];
  const stage = cursor.stage;
  const frame = (f: FrameBody): Frame => ({ ...f, stage: structuredClone(stage), effects }) as Frame;
  const labelAt = (name: string) => {
    const at = scene.labels[name];
    if (at === undefined) throw new SceneError(`없는 갈래: ${name}`);
    return at;
  };

  // 끝없이 도는 대본을 막는다
  for (let guard = 0; guard < 100_000; guard++) {
    const instr: Instr | undefined = scene.program[cursor.pc];
    if (!instr) {
      cursor.done = true;
      return { frame: frame({ kind: "end", results: cursor.results }), cursor };
    }
    cursor.pc++;
    switch (instr.op) {
      case "label":
        continue;
      case "goto":
        cursor.pc = labelAt(instr.target);
        continue;
      case "unless":
        if (!holds(instr.when, ctx, cursor)) cursor.pc = instr.to;
        continue;
      case "skip":
        cursor.pc = instr.to;
        continue;
      case "result":
        cursor.results.push(instr.result);
        continue;
      case "stage":
        applyStage(stage, effects, instr.cmd, instr.args);
        continue;
      case "line":
        return {
          frame: frame({
            kind: "line",
            ...(instr.speaker !== undefined ? { speaker: renderText(instr.speaker, ctx).map((s) => s.text).join("") } : {}),
            ...(instr.expr !== undefined ? { expr: instr.expr } : {}),
            ...(instr.small ? { small: true as const } : {}),
            segments: renderText(instr.text, ctx),
          }),
          cursor,
        };
      case "choice": {
        // 조건을 채우는 선택지만 보인다
        const visible = instr.options.filter((o) => o.when === undefined || holds(o.when, ctx, cursor));
        cursor.waiting = { kind: "choice", options: visible.map((o) => ({ text: o.text, target: o.target })) };
        return { frame: frame({ kind: "choice", options: visible.map((o, index) => ({ index, text: renderText(o.text, ctx).map((s) => s.text).join("") })) }), cursor };
      }
      case "battle":
        cursor.waiting = { kind: "battle", outcomes: instr.outcomes };
        return { frame: frame({ kind: "battle", id: instr.id, outcomes: Object.keys(instr.outcomes) as BattleOutcome[] }), cursor };
      case "pause":
        return { frame: frame({ kind: "pause", cmd: instr.cmd, arg: instr.arg }), cursor };
      case "end":
        cursor.done = true;
        return { frame: frame({ kind: "end", results: cursor.results }), cursor };
      case "next":
        cursor.done = true;
        return { frame: frame({ kind: "end", results: cursor.results, next: instr.scene }), cursor };
    }
  }
  throw new SceneError(`${scene.id}: 끝나지 않는 대본`);
}

function applyStage(stage: Stage, effects: Effect[], cmd: StageCommand, args: string[]): void {
  const [a = "", b = "", c] = args;
  switch (cmd) {
    case "등장":
      stage.actors[a] = { slot: b, expr: c ?? "기본" };
      return;
    case "퇴장":
      delete stage.actors[a];
      return;
    case "표정": {
      const actor = stage.actors[a];
      if (actor) actor.expr = b;
      return;
    }
    case "배경":
      stage.background = a;
      return;
    case "음악":
      stage.music = a;
      return;
    case "암전":
      stage.dark = true;
      return;
    case "밝아짐":
      stage.dark = false;
      return;
    case "흔들림":
    case "효과음":
    case "컷인":
    case "연출":
      effects.push({ cmd, arg: a });
      return;
  }
}

/** 선택지를 고른다 (보이는 선택지 가운데 index) */
export function choose(scene: Scene, before: Cursor, index: number): Cursor {
  const waiting = before.waiting;
  if (waiting?.kind !== "choice") throw new SceneError("선택을 기다리는 중이 아니다");
  const option = waiting.options[index];
  if (!option) throw new SceneError(`없는 선택지: ${index}`);
  const cursor = structuredClone(before);
  delete cursor.waiting;
  cursor.choices.push(option.text);
  const at = scene.labels[option.target];
  if (at === undefined) throw new SceneError(`없는 갈래: ${option.target}`);
  cursor.pc = at;
  return cursor;
}

/** 장면 안 전투의 결과로 갈래를 잇는다. 생포 갈래가 없으면 이김으로, 도망 갈래가 없으면 짐으로 */
export function battleOutcome(scene: Scene, before: Cursor, outcome: BattleOutcome): Cursor {
  const waiting = before.waiting;
  if (waiting?.kind !== "battle") throw new SceneError("전투 결과를 기다리는 중이 아니다");
  const target = waiting.outcomes[outcome] ?? (outcome === "생포" ? waiting.outcomes.이김 : outcome === "도망" ? waiting.outcomes.짐 : undefined);
  if (target === undefined) throw new SceneError(`이 전투에 없는 결과: ${outcome}`);
  const cursor = structuredClone(before);
  delete cursor.waiting;
  const at = scene.labels[target];
  if (at === undefined) throw new SceneError(`없는 갈래: ${target}`);
  cursor.pc = at;
  return cursor;
}

/**
 * 장면을 처음부터 끝까지 정해진 입력으로 돌린다 (시험·검증용).
 * choices: 차례로 고를 선택지 번호(보이는 것보다 크면 마지막 것), battles: 차례로 넘길 전투 결과. 모자라면 0번·이김.
 */
export function playThrough(
  scene: Scene,
  ctx: SceneContext,
  inputs: { choices?: number[]; battles?: BattleOutcome[] } = {},
): { frames: Frame[]; end: Extract<Frame, { kind: "end" }> } {
  const choices = [...(inputs.choices ?? [])];
  const battles = [...(inputs.battles ?? [])];
  let cursor = startScene(scene);
  const frames: Frame[] = [];
  for (let guard = 0; guard < 10_000; guard++) {
    const step = advance(scene, cursor, ctx);
    frames.push(step.frame);
    cursor = step.cursor;
    if (step.frame.kind === "end") return { frames, end: step.frame };
    // 보이는 선택지보다 큰 번호면 마지막 선택지 (조건으로 선택지 수가 달라지므로)
    if (step.frame.kind === "choice") cursor = choose(scene, cursor, Math.min(choices.shift() ?? 0, step.frame.options.length - 1));
    if (step.frame.kind === "battle") cursor = battleOutcome(scene, cursor, battles.shift() ?? "이김");
  }
  throw new SceneError(`${scene.id}: 너무 길다`);
}
