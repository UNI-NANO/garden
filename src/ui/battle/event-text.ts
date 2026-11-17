import type { BattleEvent } from "../../rules/battle/engine";

export interface EventNames {
  unit: (id: string) => string;
  effect: (id: string) => string;
  skill: (id: string) => string;
}

/** 전투 사건 하나를 한 줄 글로. 보여 줄 필요가 없는 사건은 undefined */
export function describeEvent(event: BattleEvent, names: EventNames): string | undefined {
  const u = names.unit;
  switch (event.type) {
    case "피해":
      return `${u(event.from)} → ${u(event.to)} ${event.amount}${event.judgement && event.judgement !== "좋음" ? ` (${event.judgement})` : ""}`;
    case "합":
      return `합: ${u(event.ally)} ${round(event.allyPower)} 대 ${u(event.enemy)} ${round(event.enemyPower)} — ${event.result}`;
    case "취소":
      return `${u(event.unit)}: ${event.reason}`;
    case "흐트러짐":
      return `${u(event.enemy)} 흐트러짐`;
    case "효과":
      return `${u(event.unit)}에게 ${names.effect(event.effect)} ${event.amount}`;
    case "지속 피해":
      return `${u(event.unit)} 지속 피해 ${event.amount}`;
    case "버팀":
      return `${u(event.unit)} 결의로 버팀`;
    case "연계":
      return `${u(event.unit)} 연계 +${Math.round(event.bonus * 100)}%`;
    case "터뜨림":
      return `${u(event.to)}의 ${names.effect(event.effect)} ${event.stacks} 터뜨림 → ${event.amount}`;
    case "효과 사라짐":
      return `${u(event.unit)}의 ${names.effect(event.effect)} 사라짐`;
    case "밀어냄":
      return event.pulled ? `${u(event.pushed)} 밀려남, ${u(event.pulled)} 끌려 나옴` : `${u(event.pushed)} 밀려남`;
    case "쓰러짐":
      return `${u(event.unit)} 쓰러짐${event.injury ? ` (${event.injury})` : ""}`;
    case "생포":
      return `${u(event.unit)} 생포`;
    case "대신 받음":
      return `${u(event.ally)}이(가) ${u(event.for)} 대신 받음`;
    case "이어짐":
      return `${u(event.unit)}의 ${names.skill(event.skillId)} 이어짐`;
    case "반응":
      return `${u(event.ally)} ${event.result}`;
    case "자리 옮김":
      return `${u(event.unit)} 자리 옮김`;
    case "도망":
      return `${u(event.unit)} 도망침`;
    case "끝":
      return `전투 끝: ${event.outcome}`;
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
