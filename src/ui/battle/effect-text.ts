import type { Effect } from "../../schema/defs/effect";

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

/** 효과 카드의 규칙을 한 줄 설명으로: 하는 일 · 줄어드는 때 · 최대 */
export function describeEffect(effect: Effect, effectName: (id: string) => string): string {
  const rule = effect.rule;
  let does: string;
  switch (rule.kind) {
    case "지속 피해":
      does = `턴 끝에 중첩만큼 피해${rule.healMultiplier !== undefined ? `, 받는 회복 ×${rule.healMultiplier}` : ""}`;
      break;
    case "받는 피해":
      does = rule.perStack >= 0 ? `맞을 때마다 피해 +${rule.perStack} (중첩당)` : `맞을 때마다 피해 −${-rule.perStack} (중첩당)`;
      break;
    case "움직임 불가":
      does = "자리 옮기기·도망·피하기를 못 함";
      break;
    case "공포":
      does = `판정 칸이 흔들림, 적이면 주는 위력 −${pct(rule.enemyPowerPerStack)} (중첩당)`;
      break;
    case "좋음 칸":
      does = `좋음 칸 폭 +${rule.widthPerStack} (중첩당)`;
      break;
    case "위압":
      does = `이 쪽을 칠 때 좋음 칸 ${rule.attackerWidthPerStack} (중첩당), 적이면 위력 −${pct(rule.enemyPowerPerStack)}`;
      break;
    case "완벽 없음":
      does = "완벽 칸이 사라짐";
      break;
    case "주는 위력":
      does = `주는 위력 ${rule.perStack >= 0 ? "+" : "−"}${pct(rule.perStack)} (중첩당)`;
      break;
    case "보통 배율":
      does = `「보통」 판정의 배율 +${rule.addPerStack} (중첩당, 최대 ${rule.max})`;
      break;
    case "쿨다운 더 줄임":
      does = `턴 끝에 쿨다운이 ${rule.amount} 더 줄어듦`;
      break;
    case "버티기":
      does = `쓰러질 한 방을 버텨 체력 ${rule.hpLeft}로 남음`;
      break;
    case "면역":
      does = `${rule.effects.map(effectName).join("·")}에 걸리지 않음`;
      break;
  }
  return `${does} · ${effect.decay} · 최대 ${effect.max}`;
}
