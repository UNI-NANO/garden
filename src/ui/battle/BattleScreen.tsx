import { useEffect, useRef, useState } from "preact/hooks";
import type { Firebase } from "../../data/firebase-app";
import { reportError } from "../../data/session";
import { autoAllyActions, autoDefenses } from "../../rules/battle/auto";
import { barModifiers, canMove } from "../../rules/battle/effects";
import {
  allySkills,
  canUseSkill,
  createBattle,
  defenseKey,
  incomingAttacks,
  resolveAllies,
  resolveEnemies,
  skillBarSpeed,
  skillGoodWidth,
  skillHitCount,
  skillTargets,
  type AllyAction,
  type AllyUnit,
  type BattleSetup,
  type BattleSkill,
  type BattleState,
  type Defenses,
  type DefenseInput,
  type EnemyUnit,
  type IncomingAttack,
} from "../../rules/battle/engine";
import { rowOf } from "../../rules/battle/formation";
import { reactionWidths, sweepTime } from "../../rules/battle/judge";
import { judgementWidths } from "../../rules/battle/numbers";
import type { Judgement } from "../../schema/defs/skill-table";
import type { BattleDefs } from "./defs";
import { describeEvent } from "./event-text";
import { JudgeBar } from "./JudgeBar";
import { Reaction } from "./Reaction";

/** 적 차례에 플레이어에게 반응을 묻는 중 */
interface Reacting {
  /** 이번 턴이 시작될 때의 상태 (기록을 자르는 데) */
  before: BattleState;
  /** 아군 차례가 끝난 상태 */
  state: BattleState;
  queue: IncomingAttack[];
  defenses: Defenses;
}

/** 자동 전투에서 턴 사이에 멈추는 시간 */
const AUTO_PAUSE_MS = 800;

interface Judging {
  skill: BattleSkill;
  targetId: string;
  clash: boolean;
  hitCount: number;
  done: Judgement[];
}

/** 전투 화면. 계산은 모두 rules/battle의 순수 함수가 하고, 화면은 고른 것을 넘기고 결과를 그린다 */
export function BattleScreen(props: { fb: Firebase; defs: BattleDefs; setup: BattleSetup; title: string; onRetry: () => void; onExit: () => void }) {
  const { ctx } = props.defs;
  const [battle, setBattle] = useState<BattleState>(() => createBattle(props.setup, ctx));
  const [picked, setPicked] = useState<string>();
  const [clash, setClash] = useState(false);
  const [judging, setJudging] = useState<Judging>();
  const [log, setLog] = useState<string[]>([]);
  const [problem, setProblem] = useState<string>();

  const player = battle.allies.find((a) => a.kind === "플레이어");
  const names = {
    unit: (id: string) => [...battle.allies, ...battle.enemies].find((x) => x.id === id)?.name ?? id,
    effect: (id: string) => props.defs.effectNames.get(id) ?? id,
    skill: (id: string) => (player ? allySkills(player).find((s) => s.id === id)?.name : undefined) ?? id,
  };
  const pickedSkill = player && picked ? allySkills(player).find((s) => s.id === picked) : undefined;
  const targets = player && pickedSkill ? skillTargets(battle, player, pickedSkill) : [];

  const [reacting, setReacting] = useState<Reacting>();
  const [auto, setAuto] = useState(false);
  const allySeconds = ctx.rules.timers.allySeconds;
  const [left, setLeft] = useState(allySeconds);
  const turnStart = useRef(performance.now());

  const linesOf = (before: BattleState, after: BattleState) => after.events.slice(before.events.length).flatMap((e) => describeEvent(e, names) ?? []);
  const fail = (error: unknown) => {
    reportError(props.fb, error, "전투");
    setProblem("이 행동은 지금 할 수 없어요. 다른 것을 골라 주세요.");
    setReacting(undefined);
  };
  /** 한 턴이 끝났다 */
  const finish = (before: BattleState, next: BattleState) => {
    setLog(linesOf(before, next));
    setBattle(next);
    setReacting(undefined);
    setProblem(undefined);
    turnStart.current = performance.now();
    setLeft(allySeconds);
  };
  /** 적 차례: 플레이어를 노린 공격마다 반응을 묻고, 다 모이면 실행한다. 자동이면 자동 규칙으로 */
  const enemyPhase = (before: BattleState, afterAllies: BattleState, byAuto: boolean) => {
    if (afterAllies.phase !== "적 차례") return finish(before, afterAllies);
    if (byAuto) return finish(before, resolveEnemies(afterAllies, autoDefenses(afterAllies, ctx, "자동"), ctx));
    const me = afterAllies.allies.find((a) => a.kind === "플레이어");
    const mine = me && !me.down ? incomingAttacks(afterAllies, ctx).filter((a) => a.allyId === me.id) : [];
    if (mine.length === 0) return finish(before, resolveEnemies(afterAllies, {}, ctx));
    setLog(linesOf(before, afterAllies));
    setBattle(afterAllies);
    setReacting({ before, state: afterAllies, queue: mine, defenses: {} });
  };

  /** 플레이어의 행동과 동료의 행동(성향대로 자동)으로 아군 차례를 돌린다 */
  const runTurn = (mine: AllyAction | undefined) => {
    setPicked(undefined);
    setJudging(undefined);
    setClash(false);
    turnStart.current = performance.now();
    try {
      const mates = autoAllyActions(battle, ctx).filter((a) => a.unitId !== player?.id);
      enemyPhase(battle, resolveAllies(battle, [...(mine ? [mine] : []), ...mates], ctx), false);
    } catch (error) {
      fail(error);
    }
  };

  /** 자동: 모두 자동 규칙으로 */
  const runAuto = () => {
    try {
      enemyPhase(battle, resolveAllies(battle, autoAllyActions(battle, ctx), ctx), true);
    } catch (error) {
      fail(error);
      setAuto(false);
    }
  };

  const reacted = (input: DefenseInput) => {
    if (!reacting) return;
    const [attack, ...rest] = reacting.queue;
    if (!attack) return;
    const defenses = { ...reacting.defenses, [defenseKey(attack.enemyId, attack.allyId)]: input };
    if (rest.length > 0) {
      setReacting({ ...reacting, queue: rest, defenses });
      return;
    }
    try {
      finish(reacting.before, resolveEnemies(reacting.state, defenses, ctx));
    } catch (error) {
      fail(error);
    }
  };

  // 아군 차례 제한 시간: 지나면 그 턴은 자동 규칙으로 대신 고른다
  const idle = !judging && !reacting && !battle.outcome && !auto;
  const live = useRef({ idle, timeout: () => undefined as void });
  live.current = {
    idle,
    timeout: () => {
      const action = player ? autoAllyActions(battle, ctx).find((a) => a.unitId === player.id) : undefined;
      runTurn(action);
    },
  };
  useEffect(() => {
    const timer = setInterval(() => {
      const remain = allySeconds - (performance.now() - turnStart.current) / 1000;
      setLeft(Math.max(0, Math.ceil(remain)));
      if (remain <= 0 && live.current.idle) live.current.timeout();
    }, 250);
    return () => clearInterval(timer);
  }, [allySeconds]);

  // 자동 전투: 턴 사이에 잠깐 멈추고 다음 턴
  useEffect(() => {
    if (!auto || battle.outcome || reacting || judging) return;
    const timer = setTimeout(runAuto, AUTO_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [auto, battle, reacting, judging]);

  const strikeWith = (skill: BattleSkill, target: EnemyUnit | undefined) => {
    if (!player) return;
    if (skill.stance) {
      const targetId = target?.id ?? battle.enemies.find((e) => !e.down)?.id ?? "";
      runTurn({ unitId: player.id, type: "기술", skillId: skill.id, targetId, judgements: [] });
      return;
    }
    if (!target) return;
    const withClash = clash && battle.intents.some((i) => i.enemyId === target.id && !i.cancelled);
    setJudging({ skill, targetId: target.id, clash: withClash, hitCount: skillHitCount(battle, player, skill, target), done: [] });
  };

  const choose = (skill: BattleSkill) => {
    if (!player) return;
    // 찌르지 않는 자세 기술은 대상이 필요 없다
    if (skill.stance && !skill.stanceOpts?.thrust) {
      strikeWith(skill, undefined);
      return;
    }
    setPicked(picked === skill.id ? undefined : skill.id);
    setClash(false);
  };

  const judged = (judgement: Judgement) => {
    if (!judging || !player) return;
    const done = [...judging.done, judgement];
    if (done.length < judging.hitCount) {
      setJudging({ ...judging, done });
      return;
    }
    runTurn({ unitId: player.id, type: "기술", skillId: judging.skill.id, targetId: judging.targetId, judgements: done, clash: judging.clash });
  };

  const turnLabel = battle.outcome ? "전투 끝" : reacting ? `제${battle.turn}턴 · 적 차례` : `제${battle.turn}턴 · 아군 차례`;

  return (
    <main class="battle" aria-label="전투">
      <header class="battle__bar">
        <span class="battle__turn">{turnLabel}</span>
        <span class="battle__place">{props.title}</span>
        <span class="battle__side">
          {!battle.outcome && !auto && (
            <span class="battle__timer" aria-label="남은 시간">
              {left}초
            </span>
          )}
          {!battle.outcome && (
            <button class="battle__leave" type="button" aria-pressed={auto} onClick={() => setAuto(!auto)}>
              {auto ? "자동 끄기" : "자동"}
            </button>
          )}
          <button class="battle__leave" type="button" onClick={props.onExit}>
            그만두기
          </button>
        </span>
      </header>

      <div class="battle__field">
        <Formation side="아군" units={battle.allies} render={(a) => <AllyCard ally={a} me={a.id === player?.id} />} />
        <Intents battle={battle} names={names.unit} />
        <Formation
          side="적"
          units={battle.enemies}
          render={(e) => (
            <EnemyCard
              enemy={e}
              names={props.defs.effectNames}
              selectable={targets.some((t) => t.id === e.id)}
              onPick={() => pickedSkill && strikeWith(pickedSkill, e)}
            />
          )}
        />
      </div>

      <section class="battle__log" aria-label="이번 턴" aria-live="polite">
        {problem && <p class="battle__problem">{problem}</p>}
        {log.slice(-8).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </section>

      {battle.outcome ? (
        <Result battle={battle} onRetry={props.onRetry} onExit={props.onExit} />
      ) : (
        player &&
        !auto && (
          <SkillPanel
            battle={battle}
            player={player}
            picked={picked}
            clash={clash}
            canClash={targets.length > 0}
            onChoose={choose}
            onClash={() => setClash(!clash)}
            onRest={() => runTurn({ unitId: player.id, type: "쉬기" })}
            onFlee={() => runTurn({ unitId: player.id, type: "도망" })}
          />
        )
      )}

      {reacting && reacting.queue[0] && player && (
        <Reaction
          key={`${reacting.queue[0].enemyId}>${reacting.queue[0].allyId}`}
          attack={reacting.queue[0]}
          enemyName={names.unit(reacting.queue[0].enemyId)}
          allyName={player.name}
          turn={battle.turn}
          canDodge={reacting.queue[0].big && canMove(ctx.effects, player.effects)}
          seconds={ctx.rules.timers.reactionSeconds}
          length={ctx.rules.judgementBar.length}
          sweepMs={ctx.rules.judgementBar.sweepMs}
          widthsFor={(kind) => reactionWidths(ctx.rules.reaction, kind, player.stance?.parryWidth ?? 0, ctx.rules.judgementBar.length)}
          onDone={reacted}
        />
      )}

      {judging && player && (
        <JudgeBar
          title={judging.skill.name}
          hitIndex={judging.done.length}
          hitCount={judging.hitCount}
          done={judging.done}
          length={ctx.rules.judgementBar.length}
          sweepMs={sweepTime(ctx.rules.judgementBar.sweepMs, skillBarSpeed(judging.skill))}
          widths={barWidths(battle, props.defs, player, judging)}
          onJudge={judged}
        />
      )}
    </main>
  );
}

/** 이번 타의 판정 칸 폭: 숙련도, 효과(집중·위압·공포·침식), 찍은 칸 */
function barWidths(battle: BattleState, defs: BattleDefs, player: AllyUnit, judging: Judging) {
  const target = battle.enemies.find((e) => e.id === judging.targetId);
  const mods = barModifiers(defs.ctx.effects, player.effects, target?.effects ?? {});
  return judgementWidths(defs.ctx.rules, player.mastery, {
    goodWidth: mods.goodWidth + skillGoodWidth(battle, player, judging.skill, target, judging.done.length),
    shake: mods.shake,
    noPerfect: mods.noPerfect,
    perfectWidth: judging.skill.perfectWidth ?? 0,
  });
}

/** 진형 6칸. 아군은 뒷줄 | 앞줄, 적은 앞줄 | 뒷줄 (서로 마주 본다) */
function Formation<T extends { id: string; slot: number; down: boolean }>(props: { side: "아군" | "적"; units: readonly T[]; render: (unit: T) => preact.JSX.Element }) {
  const cells = [0, 1, 2].flatMap((row) => {
    const front = row;
    const back = row + 3;
    return props.side === "아군" ? [back, front] : [front, back];
  });
  return (
    <div class={`formation formation--${props.side === "아군" ? "ally" : "enemy"}`} aria-label={props.side}>
      <p class="formation__label">{props.side === "아군" ? "아군 · 뒷줄 　 앞줄" : "앞줄 　 뒷줄 · 적"}</p>
      <div class="formation__grid">
        {cells.map((slot) => {
          const unit = props.units.find((u) => u.slot === slot && !(u as { fled?: boolean }).fled);
          return unit ? (
            <div key={slot} class={`cell ${unit.down ? "cell--down" : ""}`} data-row={rowOf(slot)}>
              {props.render(unit)}
            </div>
          ) : (
            <div key={slot} class="cell cell--empty" data-row={rowOf(slot)}>
              빈 칸
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Gauge(props: { value: number; max: number; kind: "hp" | "stagger" }) {
  const pct = props.max > 0 ? Math.max(0, Math.min(100, (props.value / props.max) * 100)) : 0;
  return (
    <div class={`gauge gauge--${props.kind}`} role="meter" aria-valuenow={Math.round(props.value)} aria-valuemin={0} aria-valuemax={props.max}>
      <div class="gauge__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function AllyCard(props: { ally: AllyUnit; me: boolean }) {
  const { ally } = props;
  return (
    <div class={`unit unit--ally ${props.me ? "unit--me" : ""}`}>
      <div class="unit__head">
        <span class="unit__name">{ally.name}</span>
        <span class="unit__note">{ally.down ? (ally.injury ?? "쓰러짐") : props.me ? "차례" : "동료"}</span>
      </div>
      <Gauge value={ally.hp} max={ally.maxHp} kind="hp" />
      <div class="unit__nums">
        체력 {ally.hp}/{ally.maxHp} · 기력 {ally.energy}
      </div>
      <Effects stacks={ally.effects} />
    </div>
  );
}

function EnemyCard(props: { enemy: EnemyUnit; names: ReadonlyMap<string, string>; selectable: boolean; onPick: () => void }) {
  const { enemy } = props;
  const broken = enemy.brokenOnTurn !== null;
  return (
    <button
      class={`unit unit--enemy ${props.selectable ? "unit--target" : ""}`}
      type="button"
      disabled={!props.selectable}
      aria-label={`${enemy.name}${props.selectable ? " 고르기" : ""}`}
      onClick={props.onPick}
    >
      <div class="unit__head">
        <span class="unit__name">{enemy.name}</span>
        <span class="unit__note">{enemy.down ? (enemy.captured ? "생포" : "쓰러짐") : broken ? "흐트러짐" : props.selectable ? "대상" : ""}</span>
      </div>
      <Gauge value={enemy.hp} max={enemy.maxHp} kind="hp" />
      <Gauge value={enemy.stagger} max={enemy.maxStagger} kind="stagger" />
      <div class="unit__nums">
        체력 {enemy.hp}/{enemy.maxHp}
      </div>
      <Effects stacks={enemy.effects} names={props.names} />
    </button>
  );
}

function Effects(props: { stacks: Readonly<Record<string, number>>; names?: ReadonlyMap<string, string> }) {
  const list = Object.entries(props.stacks).filter(([, n]) => n > 0);
  if (list.length === 0) return null;
  return (
    <div class="unit__effects">
      {list.map(([id, n]) => (
        <span key={id} class="effect">
          {props.names?.get(id) ?? id} {n}
        </span>
      ))}
    </div>
  );
}

function Intents(props: { battle: BattleState; names: (id: string) => string }) {
  const intents = props.battle.intents.filter((i) => !i.cancelled);
  return (
    <section class="intents" aria-label="적의 의도">
      {intents.length === 0 && !props.battle.outcome && <p class="intent intent--none">이번 턴 움직이는 적 없음</p>}
      {intents.map((intent) => (
        <p key={intent.enemyId} class="intent">
          <span class="intent__who">{props.names(intent.enemyId)}</span>
          <span class="intent__what">
            {intent.actionName} · {Math.round(intent.power * 10) / 10}
          </span>
          <span class="intent__target">→ {props.names(intent.targetId)}</span>
        </p>
      ))}
    </section>
  );
}

function SkillPanel(props: {
  battle: BattleState;
  player: AllyUnit;
  picked: string | undefined;
  clash: boolean;
  canClash: boolean;
  onChoose: (skill: BattleSkill) => void;
  onClash: () => void;
  onRest: () => void;
  onFlee: () => void;
}) {
  const { battle, player } = props;
  if (player.down) {
    return (
      <section class="skills" aria-label="기술">
        <p class="skills__note">쓰러져 움직일 수 없어요. 동료가 싸웁니다.</p>
        <button class="button" type="button" onClick={props.onRest}>
          다음 턴
        </button>
      </section>
    );
  }
  const kindOf = (skill: BattleSkill) => (skill.id === player.basicAttack.id ? "기본 공격" : skill.id === player.ultimate?.id ? "궁극기" : "기본기");
  return (
    <section class="skills" aria-label="기술">
      {allySkills(player).map((skill) => {
        const cooldown = player.cooldowns[skill.id] ?? 0;
        const reachOk = skill.reach === "원거리" || rowOf(player.slot) === "앞줄";
        const hasTarget = skill.stance || skillTargets(battle, player, skill).length > 0;
        const usable = canUseSkill(player, skill) && reachOk && hasTarget;
        const why = cooldown > 0 ? `쿨다운 ${cooldown}` : player.energy < skill.energy ? `기력 ${skill.energy} 필요` : !reachOk ? "뒷줄에서는 못 씀" : !hasTarget ? "고를 대상 없음" : undefined;
        const power = skill.stance ? "자세" : `위력 ${Math.round(skill.baseHitPower * skill.hitCount * 10) / 10}`;
        return (
          <button
            key={skill.id}
            class={`skill ${kindOf(skill) === "궁극기" ? "skill--ultimate" : ""} ${props.picked === skill.id ? "skill--picked" : ""}`}
            type="button"
            disabled={!usable}
            aria-pressed={props.picked === skill.id}
            onClick={() => props.onChoose(skill)}
          >
            <span class="skill__kind">
              {kindOf(skill)} · {skill.role}
            </span>
            <span class="skill__name">{skill.name}</span>
            <span class="skill__info">{why ?? `${skill.damageType} · 기력 ${skill.energy} · ${power}`}</span>
          </button>
        );
      })}
      <div class="skills__side">
        {props.picked !== undefined && <p class="skills__note">칠 적을 고르세요</p>}
        <button class="button" type="button" aria-pressed={props.clash} disabled={!props.canClash} onClick={props.onClash}>
          {props.clash ? "합 걸기 켜짐" : "합 걸기"}
        </button>
        <button class="button" type="button" onClick={props.onRest}>
          쉬기
        </button>
        <button class="button" type="button" disabled={battle.kind !== "일반"} onClick={props.onFlee}>
          도망
        </button>
      </div>
    </section>
  );
}

function Result(props: { battle: BattleState; onRetry: () => void; onExit: () => void }) {
  const { battle } = props;
  const player = battle.allies.find((a) => a.kind === "플레이어");
  return (
    <section class="paper result" aria-label="전투 결과">
      <h2 class="paper__heading">{battle.outcome}</h2>
      <p>
        {battle.turn}턴 · 내 체력 {player?.hp ?? 0}/{player?.maxHp ?? 0}
        {player?.injury ? ` · ${player.injury}` : ""}
      </p>
      <p class="result__note">연습 전투라 저장하지 않고 보상도 없어요.</p>
      <div class="result__buttons">
        <button class="button button--main" type="button" onClick={props.onRetry}>
          다시
        </button>
        <button class="button" type="button" onClick={props.onExit}>
          돌아가기
        </button>
      </div>
    </section>
  );
}
