import { autoAllyActions, autoDefenses, type DefensePolicy } from "./auto";
import { createBattle, playTurn, type BattleContext, type BattleSetup, type BattleState, type Injury, type Outcome, type TurnInput } from "./engine";

export interface SimulationResult {
  outcome: Outcome | "끝나지 않음";
  /** 끝난 턴 */
  turns: number;
  allies: { name: string; hp: number; maxHp: number; injury: Injury | undefined }[];
  /** 다시 돌릴 수 있는 행동 기록 */
  record: TurnInput[];
  final: BattleState;
}

/** 스스로 고르는 규칙으로 한 판을 끝까지 돌린다. 균형 시험과 자동 전투에 쓴다 */
export function simulateBattle(setup: BattleSetup, ctx: BattleContext, policy: DefensePolicy, maxTurns = 50): SimulationResult {
  let state = createBattle(setup, ctx);
  const record: TurnInput[] = [];
  while (state.outcome === undefined && state.turn <= maxTurns) {
    const input: TurnInput = { actions: autoAllyActions(state, ctx), defenses: autoDefenses(state, ctx, policy) };
    record.push(input);
    state = playTurn(state, input, ctx);
  }
  return {
    outcome: state.outcome ?? "끝나지 않음",
    turns: state.outcome === undefined ? maxTurns : state.turn,
    allies: state.allies.map((a) => ({ name: a.name, hp: a.hp, maxHp: a.maxHp, injury: a.injury })),
    record,
    final: state,
  };
}
