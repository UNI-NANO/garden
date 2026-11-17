import type { Character } from "../../schema/character";
import type { Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import type { ItemGain } from "../exchange";
import type { Result, ResultCommand } from "./parse";

/**
 * 장면이 끝날 때 결과를 캐릭터에 적용한 모습을 계산한다 (명세서 「장면」: 끝날 때 한 번에).
 * 받을 자리가 있는 결과는 바로, 아직 시스템이 없는 결과(숙련·시작직업·칭호·기술·레시피·세계표시, 정의에 없는 물건)는 보류 목록에 남긴다.
 * 잎전과 물건은 「주고받기」로 넘기도록 walletDelta·gains로 내놓는다.
 */

type Quest = Character["quests"][number];
type Pending = Character["pendingResults"][number];

export interface SceneApplyInput {
  sceneId: string;
  results: readonly Result[];
  marks: readonly string[];
  clues: readonly string[];
  quests: readonly Quest[];
  people: Character["people"];
  abilities: Character["abilities"];
  pending: readonly Pending[];
  limits: Limits;
  items: ReadonlyMap<string, Item>;
  /** 결과 인자 안의 {친구} 같은 바꿔 넣기 */
  resolve: (text: string) => string;
}

export interface SceneApplyOutput {
  marks: string[];
  clues: string[];
  quests: Quest[];
  people: Character["people"];
  abilities: Character["abilities"];
  pending: Pending[];
  walletDelta: number;
  gains: ItemGain[];
  /** 화면에 보일 요약 */
  summary: string[];
}

/** 보류되는 결과: 받을 자리가 아직 없다 */
export const PENDING_COMMANDS: readonly ResultCommand[] = ["숙련", "시작직업", "칭호", "기술", "레시피", "세계표시"];

const ABILITY_KEYS: Record<string, keyof Character["abilities"]> = { 건강: "health", 정신력: "spirit", 신용: "credit", 인맥: "connections", 평판: "reputation" };

/** 대본의 이름(밑줄)을 사람이 읽는 글로 */
const display = (text: string) => text.replaceAll("_", " ");

export function applySceneResults(input: SceneApplyInput): SceneApplyOutput {
  const out: SceneApplyOutput = {
    marks: [...input.marks],
    clues: [...input.clues],
    quests: input.quests.map((q) => ({ ...q })),
    people: structuredClone(input.people),
    abilities: { ...input.abilities },
    pending: [...input.pending],
    walletDelta: 0,
    gains: [],
    summary: [],
  };
  const { min, max } = input.limits.abilities;
  const shiftAbility = (key: keyof Character["abilities"], label: string, by: number) => {
    out.abilities[key] = Math.max(min, Math.min(max, out.abilities[key] + by));
    out.summary.push(`${label} ${by >= 0 ? "+" : ""}${by}`);
  };
  const personKey = (name: string) => Object.entries(out.people).find(([, p]) => p.name === name)?.[0];
  const newPersonKey = () => {
    for (let n = Object.keys(out.people).length; ; n++) if (!(`p${n}` in out.people)) return `p${n}`;
  };
  const pend = (result: Result, args: string[]) => {
    out.pending.push({ scene: input.sceneId, cmd: result.cmd, args });
    out.summary.push(`나중에: [${result.cmd} ${args.join(" ")}]`);
  };

  for (const result of input.results) {
    const args = result.args.map(input.resolve);
    const [a = "", b = ""] = args;
    switch (result.cmd) {
      case "표시":
        if (!out.marks.includes(a)) out.marks.push(a);
        break;
      case "단서":
        if (!out.clues.includes(a)) {
          out.clues.push(a);
          out.summary.push(`단서: ${display(a)}`);
        }
        break;
      case "친밀도": {
        const by = Number(b);
        const key = personKey(a);
        if (key) out.people[key]!.intimacy += by;
        else out.people[newPersonKey()] = { name: a, relation: "", intimacy: by, note: "" };
        out.summary.push(`${a} 친밀도 ${by >= 0 ? "+" : ""}${by}`);
        break;
      }
      case "인물": {
        const key = personKey(a);
        if (key) out.people[key]!.relation = display(b);
        else out.people[newPersonKey()] = { name: a, relation: display(b), intimacy: 0, note: "" };
        out.summary.push(`인물: ${a} (${display(b)})`);
        break;
      }
      case "퀘스트": {
        const quest = out.quests.find((q) => q.id === a);
        if (b === "시작") {
          if (!quest) out.quests.push({ id: a, state: "시작", steps: 0 });
        } else if (b === "진행") {
          if (quest) {
            quest.steps += 1;
            if (quest.state === "시작") quest.state = "진행";
          } else out.quests.push({ id: a, state: "진행", steps: 1 });
        } else if (quest) quest.state = "완료";
        else out.quests.push({ id: a, state: "완료", steps: 0 });
        out.summary.push(`퀘스트 ${display(a)}: ${b}`);
        break;
      }
      case "능력치":
        shiftAbility(ABILITY_KEYS[a]!, a, Number(b));
        break;
      case "평판":
        shiftAbility("reputation", "평판", Number(a));
        break;
      case "신용":
        shiftAbility("credit", "신용", Number(a));
        break;
      case "주기": {
        const quantity = Number(b);
        if (a === "잎전") {
          out.walletDelta += quantity;
          out.summary.push(`잎전 +${quantity}`);
          break;
        }
        // 물건 정의의 이름으로 찾는다(밑줄은 띄어쓰기). 묶음 물건만 바로, 그 밖은 보류
        const item = [...input.items.values()].find((i) => i.name === display(a));
        if (item && item.kind === "묶음") {
          out.gains.push({ kind: "묶음", itemId: item.id, quantity, freshness: 100, quality: "중" });
          out.summary.push(`${item.name} ${quantity}`);
        } else pend(result, args);
        break;
      }
      case "숙련":
      case "시작직업":
      case "칭호":
      case "기술":
      case "레시피":
      case "세계표시":
        pend(result, args);
        break;
    }
  }
  return out;
}
