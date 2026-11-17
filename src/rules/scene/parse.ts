/**
 * 장면 대본 파서 (docs/대본집.md 「대본 형식」과 각 장의 「새로 쓰인 명령」).
 * 대본집의 ``` 코드 블록 가운데 `# 장면: ID`로 시작하는 것을 장면으로 읽어, 위에서 아래로 도는 명령 목록으로 만든다.
 * 갈래(`@이름`)는 표지, `[합류]`는 그리로 가기, `[만약]`·`[아니면]`·`[만약 끝]`은 건너뛰기로 바뀐다.
 */

/** 조건: `표시:키`, `세계표시:키`, `단서:키`, `퀘스트:ID`, `집안:값`, `재능:이름`, `이름 숫자`(능력치·숙련도가 그 이상) */
export type Condition =
  | { kind: "표시" | "세계표시" | "단서" | "퀘스트" | "집안" | "재능"; key: string }
  | { kind: "수치"; name: string; atLeast: number };

/** 자리. 뒷줄은 가운데 뒤에 작고 흐리게 (멀리서 지켜보는 사람) */
export const SLOTS = ["왼쪽", "가운데", "오른쪽", "뒷줄"] as const;
export const EXPRESSIONS = ["기본", "웃음", "화남", "놀람"] as const;
export const SHAKES = ["약", "중", "강"] as const;
export const ABILITY_NAMES = ["건강", "정신력", "신용", "인맥", "평판"] as const;
export const BATTLE_OUTCOMES = ["이김", "짐", "생포", "도망"] as const;
export type BattleOutcome = (typeof BATTLE_OUTCOMES)[number];

/** 화면만 바꾸는 연출 명령 */
export const STAGE_COMMANDS = ["등장", "퇴장", "표정", "배경", "흔들림", "효과음", "컷인", "암전", "밝아짐", "연출", "음악"] as const;
export type StageCommand = (typeof STAGE_COMMANDS)[number];
/** 장면을 잠시 멈추는 명령: 다른 화면 열기, GM 승인 기다리기, 일생 요약, 설명 카드 */
export const PAUSE_COMMANDS = ["화면", "대기", "일생", "안내"] as const;
export type PauseCommand = (typeof PAUSE_COMMANDS)[number];
/** 장면이 끝날 때 한 번에 적용되는 결과 명령 */
export const RESULT_COMMANDS = ["표시", "세계표시", "친밀도", "단서", "주기", "퀘스트", "평판", "신용", "능력치", "숙련", "인물", "시작직업", "칭호", "기술", "레시피"] as const;
export type ResultCommand = (typeof RESULT_COMMANDS)[number];

export interface Result {
  cmd: ResultCommand;
  args: string[];
}

export type Instr =
  /** 대사. speaker가 없으면 서술 */
  | { op: "line"; speaker?: string; expr?: string; text: string; line: number; small?: true }
  | { op: "stage"; cmd: StageCommand; args: string[]; line: number }
  | { op: "pause"; cmd: PauseCommand; arg: string; line: number }
  | { op: "result"; result: Result; line: number }
  | { op: "choice"; options: { text: string; target: string; when?: Condition }[]; line: number }
  | { op: "battle"; id: string; outcomes: Partial<Record<BattleOutcome, string>>; line: number }
  /** [합류 갈래] */
  | { op: "goto"; target: string; line: number }
  /** [만약 조건]: 조건이 아니면 to로 */
  | { op: "unless"; when: Condition; to: number; line: number }
  /** [아니면] 앞의 끝: [만약 끝] 다음으로 */
  | { op: "skip"; to: number; line: number }
  | { op: "label"; name: string; line: number }
  | { op: "end"; line: number }
  /** [이어서 장면ID]: 이 장면을 끝내고(결과 적용) 그 장면을 바로 이어 본다 */
  | { op: "next"; scene: string; line: number };

export interface Scene {
  id: string;
  /** 대본집에서의 줄 번호 (`# 장면:` 줄) */
  line: number;
  background?: string;
  music?: string;
  program: Instr[];
  /** 갈래 이름 → 명령 위치 */
  labels: Record<string, number>;
}

export interface ScriptIssue {
  scene: string;
  line: number;
  message: string;
}

/** 조건 글을 읽는다. 읽지 못하면 undefined */
export function parseCondition(text: string): Condition | undefined {
  const t = text.trim();
  const keyed = /^(표시|세계표시|단서|퀘스트|집안|재능):(\S.*)$/.exec(t);
  if (keyed) return { kind: keyed[1] as "표시", key: keyed[2]!.trim() };
  const number = /^(\S+) ([0-9]+)$/.exec(t);
  if (number) return { kind: "수치", name: number[1]!, atLeast: Number(number[2]) };
  return undefined;
}

const SIGNED = /^[+-][0-9]+$/;
const INT = /^[0-9]+$/;

/** 결과 명령의 인자 모양 검사. 틀리면 이유 */
function checkResult(cmd: ResultCommand, args: string[]): string | undefined {
  const need = (n: number) => (args.length === n ? undefined : `[${cmd}]에는 인자가 ${n}개 (지금 ${args.length})`);
  switch (cmd) {
    case "표시":
    case "세계표시":
    case "단서":
    case "칭호":
    case "기술":
    case "레시피":
      return need(1);
    case "평판":
    case "신용":
      return need(1) ?? (SIGNED.test(args[0]!) ? undefined : `[${cmd}]의 값은 +n 또는 -n`);
    case "친밀도":
    case "숙련":
      return need(2) ?? (SIGNED.test(args[1]!) ? undefined : `[${cmd}]의 값은 +n 또는 -n`);
    case "능력치":
      return (
        need(2) ??
        (!(ABILITY_NAMES as readonly string[]).includes(args[0]!) ? `없는 능력치: ${args[0]}` : SIGNED.test(args[1]!) ? undefined : "[능력치]의 값은 +n 또는 -n")
      );
    case "주기":
      return need(2) ?? (INT.test(args[1]!) && Number(args[1]) > 0 ? undefined : "[주기]의 수량은 1 이상");
    case "퀘스트":
      return need(2) ?? (args[1] === "진행" || args[1] === "시작" || args[1] === "완료" ? undefined : "[퀘스트]는 「ID 시작」·「ID 진행」·「ID 완료」");
    case "인물":
      return need(2);
    case "시작직업":
      return need(2) ?? (INT.test(args[1]!) ? undefined : "[시작직업]의 단계는 숫자");
  }
}

function checkStage(cmd: StageCommand, args: string[]): string | undefined {
  switch (cmd) {
    case "등장":
      if (args.length < 2 || args.length > 3) return "[등장 이름 자리 표정]";
      if (!(SLOTS as readonly string[]).includes(args[1]!)) return `자리는 왼쪽·가운데·오른쪽·뒷줄 (지금 ${args[1]})`;
      if (args[2] !== undefined && !(EXPRESSIONS as readonly string[]).includes(args[2])) return `없는 표정: ${args[2]}`;
      return undefined;
    case "표정":
      if (args.length !== 2) return "[표정 이름 표정]";
      return (EXPRESSIONS as readonly string[]).includes(args[1]!) ? undefined : `없는 표정: ${args[1]}`;
    case "흔들림":
      return args.length === 1 && (SHAKES as readonly string[]).includes(args[0]!) ? undefined : "[흔들림 약/중/강]";
    case "암전":
    case "밝아짐":
      return args.length === 0 ? undefined : `[${cmd}]에는 인자가 없다`;
    default:
      return args.length >= 1 ? undefined : `[${cmd}]에는 이름이 있어야 한다`;
  }
}

/** 대본집 전체에서 장면들을 읽는다. 문제가 있으면 issues에 (장면은 문제가 있어도 가능한 만큼 읽는다) */
export function parseScriptBook(markdown: string): { scenes: Scene[]; issues: ScriptIssue[] } {
  const scenes: Scene[] = [];
  const issues: ScriptIssue[] = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== "```") continue;
    // 코드 블록의 끝을 찾는다
    let end = i + 1;
    while (end < lines.length && lines[end]!.trim() !== "```") end++;
    // 한 블록에 장면이 여럿일 수 있다 (`# 장면:` 줄마다 새 장면). 「대본 형식」의 견본(`장면 ID`)은 장면이 아니다
    let start = -1;
    const flush = (stop: number) => {
      if (start < 0) return;
      const body = lines.slice(start, stop);
      if (body[0]!.slice("# 장면:".length).trim() !== "장면 ID") {
        const { scene, issues: found } = parseScene(body, start + 1);
        scenes.push(scene);
        issues.push(...found);
      }
    };
    for (let j = i + 1; j < end; j++) {
      if (!lines[j]!.startsWith("# 장면:")) continue;
      flush(j);
      start = j;
    }
    flush(end);
    i = end;
  }
  const ids = new Set(scenes.map((s) => s.id));
  for (const scene of scenes) {
    for (const instr of scene.program) {
      if (instr.op === "next" && !ids.has(instr.scene)) issues.push({ scene: scene.id, line: instr.line, message: `없는 장면으로 이어 간다: ${instr.scene}` });
    }
  }
  const seen = new Map<string, number>();
  for (const scene of scenes) {
    const before = seen.get(scene.id);
    if (before !== undefined) issues.push({ scene: scene.id, line: scene.line, message: `같은 장면 ID가 ${before}줄에도 있다` });
    seen.set(scene.id, scene.line);
  }
  return { scenes, issues };
}

/** 장면 하나. firstLine은 `# 장면:` 줄의 대본집 줄 번호 */
export function parseScene(body: string[], firstLine: number): { scene: Scene; issues: ScriptIssue[] } {
  const id = body[0]!.slice("# 장면:".length).trim();
  const issues: ScriptIssue[] = [];
  const scene: Scene = { id, line: firstLine, program: [], labels: {} };
  const add = (line: number, message: string) => issues.push({ scene: id, line, message });
  const program = scene.program;
  /** 열린 [만약]들: unless 위치, [아니면]이 있으면 skip 위치 */
  const ifs: { unless: number; skip?: number; line: number }[] = [];
  let header = true;

  for (let n = 1; n < body.length; n++) {
    const raw = body[n]!;
    const line = firstLine + n;
    const t = raw.trim();
    if (t === "") continue;

    // 머리: 배경·음악 (첫 대사 앞). 그 뒤의 「배경:」 줄은 배경 바꾸기
    const meta = /^(배경|음악):\s*(.+)$/.exec(t);
    if (meta) {
      const [, key, value] = meta;
      if (header) {
        if (key === "배경") scene.background = value!.trim();
        else scene.music = value!.trim();
      } else program.push({ op: "stage", cmd: key as "배경", args: [value!.trim()], line });
      continue;
    }
    header = false;

    if (t === "> 선택") {
      const options: { text: string; target: string; when?: Condition }[] = [];
      while (n + 1 < body.length && /^\s*-\s/.test(body[n + 1]!)) {
        n++;
        const option = /^\s*-\s+(.+?)\s*→\s*(\S+)(?:\s+\?(.+))?\s*$/.exec(body[n]!);
        if (!option) {
          add(firstLine + n, `선택지 모양이 틀리다: ${body[n]!.trim()}`);
          continue;
        }
        const [, text, target, cond] = option;
        if (cond !== undefined) {
          const when = parseCondition(cond);
          if (!when) add(firstLine + n, `읽지 못한 조건: ?${cond}`);
          else options.push({ text: text!, target: target!, when });
        } else options.push({ text: text!, target: target! });
      }
      if (options.length === 0) add(line, "선택지가 없다");
      program.push({ op: "choice", options, line });
      continue;
    }

    if (t.startsWith("@")) {
      const name = t.slice(1).trim();
      if (name in scene.labels) add(line, `같은 갈래가 두 번: @${name}`);
      scene.labels[name] = program.length;
      program.push({ op: "label", name, line });
      continue;
    }

    const bracket = /^\[(.+)\]$/.exec(t);
    if (bracket) {
      const inner = bracket[1]!.trim();
      if (inner === "끝") {
        program.push({ op: "end", line });
        continue;
      }
      if (inner.startsWith("만약 ") && inner !== "만약 끝") {
        const when = parseCondition(inner.slice(3));
        if (!when) add(line, `읽지 못한 조건: ${inner.slice(3)}`);
        ifs.push({ unless: program.length, line });
        program.push({ op: "unless", when: when ?? { kind: "표시", key: "" }, to: -1, line });
        continue;
      }
      if (inner === "아니면") {
        const open = ifs.at(-1);
        if (!open || open.skip !== undefined) {
          add(line, "[아니면] 앞에 [만약]이 없다");
          continue;
        }
        open.skip = program.length;
        program.push({ op: "skip", to: -1, line });
        (program[open.unless] as Extract<Instr, { op: "unless" }>).to = program.length;
        continue;
      }
      if (inner === "만약 끝") {
        const open = ifs.pop();
        if (!open) {
          add(line, "[만약 끝] 앞에 [만약]이 없다");
          continue;
        }
        if (open.skip !== undefined) (program[open.skip] as Extract<Instr, { op: "skip" }>).to = program.length;
        else (program[open.unless] as Extract<Instr, { op: "unless" }>).to = program.length;
        continue;
      }
      if (inner.startsWith("전투 ")) {
        const battle = /^전투\s+(\S+)\s*→\s*(.+)$/.exec(inner);
        if (!battle) {
          add(line, "[전투 적조합ID → 이김:갈래 짐:갈래]");
          continue;
        }
        const outcomes: Partial<Record<BattleOutcome, string>> = {};
        for (const pair of battle[2]!.trim().split(/\s+/)) {
          const [key, label] = pair.split(":");
          if (!(BATTLE_OUTCOMES as readonly string[]).includes(key ?? "") || !label) add(line, `전투 결과 모양이 틀리다: ${pair}`);
          else outcomes[key as BattleOutcome] = label;
        }
        if (!outcomes.이김 || !outcomes.짐) add(line, "[전투]에는 이김과 짐이 있어야 한다");
        program.push({ op: "battle", id: battle[1]!, outcomes, line });
        continue;
      }
      const [cmd = "", ...args] = inner.split(/\s+/);
      if (cmd === "이어서") {
        if (args.length !== 1) add(line, "[이어서 장면ID]");
        program.push({ op: "next", scene: args[0] ?? "", line });
      } else if (cmd === "합류") {
        if (args.length !== 1) add(line, "[합류 갈래이름]");
        program.push({ op: "goto", target: args[0] ?? "", line });
      } else if ((STAGE_COMMANDS as readonly string[]).includes(cmd)) {
        const problem = checkStage(cmd as StageCommand, args);
        if (problem) add(line, problem);
        program.push({ op: "stage", cmd: cmd as StageCommand, args, line });
      } else if ((PAUSE_COMMANDS as readonly string[]).includes(cmd)) {
        if (args.length !== 1) add(line, `[${cmd} 이름]`);
        program.push({ op: "pause", cmd: cmd as PauseCommand, arg: args[0] ?? "", line });
      } else if ((RESULT_COMMANDS as readonly string[]).includes(cmd)) {
        const problem = checkResult(cmd as ResultCommand, args);
        if (problem) add(line, problem);
        program.push({ op: "result", result: { cmd: cmd as ResultCommand, args }, line });
      } else add(line, `모르는 명령: [${inner}]`);
      continue;
    }

    const speech = /^([^:(]+?)(?:\(([^)]*)\))?:\s*(.*)$/.exec(t);
    if (speech) {
      const [, who, expr, text] = speech;
      if (who!.trim() === "서술") program.push({ op: "line", text: text!, line });
      else if (expr === "작게") {
        // 속삭이는 말: 기본 표정에 작은 글씨
        program.push({ op: "line", speaker: who!.trim(), expr: "기본", text: text!, line, small: true });
      } else {
        if (expr !== undefined && !(EXPRESSIONS as readonly string[]).includes(expr)) add(line, `없는 표정: ${expr}`);
        program.push({ op: "line", speaker: who!.trim(), ...(expr !== undefined ? { expr } : {}), text: text!, line });
      }
      continue;
    }
    add(line, `읽지 못한 줄: ${t}`);
  }

  for (const open of ifs) add(open.line, "[만약]이 [만약 끝]으로 닫히지 않았다");
  issues.push(...checkFlow(scene));
  return { scene, issues };
}

/** 흐름 검사: 없는 갈래로 가기, 끝이 없음, 갈래로 흘러 들어감, 마지막이 끝나지 않음 */
function checkFlow(scene: Scene): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const add = (line: number, message: string) => issues.push({ scene: scene.id, line, message });
  const exists = (name: string) => name in scene.labels;
  for (const [index, instr] of scene.program.entries()) {
    if (instr.op === "goto" && !exists(instr.target)) add(instr.line, `없는 갈래로 합류: ${instr.target}`);
    if (instr.op === "choice") for (const o of instr.options) if (!exists(o.target)) add(instr.line, `없는 갈래로 가는 선택지: ${o.target}`);
    if (instr.op === "battle") for (const target of Object.values(instr.outcomes)) if (!exists(target)) add(instr.line, `없는 갈래로 가는 전투 결과: ${target}`);
    // 앞 갈래가 끝나지 않고 다음 갈래로 흘러 들어가면 실수일 가능성이 크다 (합류나 끝으로 맺는다)
    if (instr.op === "label" && index > 0) {
      const before = scene.program[index - 1]!;
      if (before.op !== "goto" && before.op !== "end" && before.op !== "next" && before.op !== "choice" && before.op !== "battle" && before.op !== "label") {
        add(instr.line, `앞 줄에서 @${instr.name}로 그냥 흘러 들어간다 ([합류 ${instr.name}]나 [끝]으로 맺는다)`);
      }
    }
  }
  if (!scene.program.some((i) => i.op === "end" || i.op === "next")) add(scene.line, "[끝]이 없다");
  const last = scene.program.at(-1);
  if (last && last.op !== "end" && last.op !== "goto" && last.op !== "next") add(last.line, "마지막 줄이 [끝]·[합류]·[이어서]가 아니다");
  return issues;
}
