import { push, ref } from "firebase/database";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import rawHunting from "../../../data/defs/hunting.json";
import rawItems from "../../../data/defs/items.json";
import {
  commitHunting,
  HUNTING_FATIGUE,
  type HuntingCommitResult,
} from "../../data/hunting";
import type { Firebase } from "../../data/firebase-app";
import { firebasePort } from "../../data/firebase-port";
import { reportError, type Session } from "../../data/session";
import { allyOfCharacter } from "../../rules/battle/ally-of";
import type { BattleSetup, BattleState } from "../../rules/battle/engine";
import { parseMonthKey, seasonOf } from "../../rules/calendar";
import { fatigueMultiplier } from "../../rules/dungeon/end";
import { curveSteps } from "../../rules/fishing";
import {
  approachAlert,
  BAR_LENGTH,
  barWidths,
  HuntingError,
  isDownwind,
  planHunt,
  replayHunt,
  type Direction,
  type HuntAction,
} from "../../rules/hunting";
import { HuntingDefsSchema, type HuntingDefs } from "../../schema/defs/hunting";
import { ItemListSchema, type Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import { BattleScreen } from "../battle/BattleScreen";
import { loadBattleDefs, type BattleDefs } from "../battle/defs";
import { Bar, useSweep } from "../battle/JudgeBar";
import "../battle/battle.css";
import { Notice, Paper } from "../parts";
import "./hunting.css";

type SignedIn = Extract<Session, { status: "signedIn" }>;
const GROUND_ID = "tesanga-grassland";
const ARROWS: Record<Direction, string> = {
  북: "↑",
  동: "→",
  남: "↓",
  서: "←",
};
/** 바람이 불어오는 쪽 → 바람이 가는 쪽 화살표 */
const WIND_ARROW: Record<Direction, string> = {
  북: "↓",
  동: "←",
  남: "↑",
  서: "→",
};

/**
 * 사냥 (docs/ui/Hunt, 8단계 ② 다). 흔적을 읽고 갈림길마다 길을 고른다(바람을 등지면 냄새가 간다, 빠르게 걸으면 소리가 난다).
 * 짐승이 보이면 더 다가가거나 쏜다(전투의 판정 바, 가까울수록 칸이 넓다). 멧돼지는 스치면 달려들어 싸움이 된다.
 */
export function HuntingScreen(props: {
  fb: Firebase;
  limits: Limits;
  session: SignedIn;
  onExit: () => void;
}) {
  const defs = useMemo<
    | {
        hunting: HuntingDefs;
        items: ReadonlyMap<string, Item>;
        battle: BattleDefs;
      }
    | Error
  >(() => {
    try {
      return {
        hunting: HuntingDefsSchema.parse(rawHunting),
        items: new Map(
          ItemListSchema.parse(rawItems).items.map((i) => [i.id, i]),
        ),
        battle: loadBattleDefs(),
      };
    } catch (error) {
      reportError(props.fb, error, "사냥 정의 읽기");
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [props.fb]);
  const { character, characterId } = props.session;
  if (defs instanceof Error)
    return (
      <Notice title="사냥">
        사냥터 기록을 읽지 못했어요. 기록해 두었어요.
      </Notice>
    );
  if (!character || !characterId)
    return <Notice title="사냥">열람증이 준비되면 사냥할 수 있어요.</Notice>;
  if (!defs.hunting.grounds.some((g) => g.id === GROUND_ID))
    return <Notice title="사냥">사냥터를 찾지 못했어요.</Notice>;
  return (
    <Hunting
      {...props}
      defs={defs}
      characterId={characterId}
      character={character}
    />
  );
}

function Hunting(props: {
  fb: Firebase;
  limits: Limits;
  onExit: () => void;
  defs: {
    hunting: HuntingDefs;
    items: ReadonlyMap<string, Item>;
    battle: BattleDefs;
  };
  characterId: string;
  character: NonNullable<SignedIn["character"]>;
}) {
  const { fb, limits, defs, character, characterId } = props;
  const { rules } = defs.hunting;
  const ground = defs.hunting.grounds.find((g) => g.id === GROUND_ID)!;
  const season = seasonOf(parseMonthKey(character.month.key)?.index ?? 0);
  const today = character.month.fatigue[HUNTING_FATIGUE] ?? 0;
  const steps = curveSteps(
    fatigueMultiplier(today + 1, limits),
    limits.dungeon.fatigueCurve,
  );

  const newSeed = () => push(ref(fb.db, "requests")).key ?? `hunt${Date.now()}`;
  const [seed, setSeed] = useState(newSeed);
  const hunt = useMemo(() => planHunt(seed, ground, season, rules), [seed]);
  const [actions, setActions] = useState<HuntAction[]>([]);
  const [pace, setPace] = useState<"조용히" | "빠르게">("조용히");
  const [aiming, setAiming] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [battle, setBattle] = useState<BattleSetup>();
  const [saved, setSaved] = useState<HuntingCommitResult | "saving">();
  const committed = useRef(false);
  const state = useMemo(
    () => replayHunt(hunt, actions, rules),
    [hunt, actions],
  );
  const itemName = (id: string) => defs.items.get(id)?.name ?? id;

  const add = (action: HuntAction) => {
    try {
      const next = [...actions, action];
      replayHunt(hunt, next, rules);
      setActions(next);
      setNotice(undefined);
    } catch (error) {
      if (error instanceof HuntingError) setNotice(error.message);
      else reportError(fb, error, "사냥");
    }
  };

  const save = async (battleWon?: boolean) => {
    if (committed.current) return;
    committed.current = true;
    setSaved("saving");
    try {
      const requestId =
        push(ref(fb.db, "requests")).key ?? `hunt-save${Date.now()}`;
      const result = await commitHunting(
        firebasePort(fb.db),
        characterId,
        requestId,
        {
          groundId: ground.id,
          seed,
          actions,
          ...(battleWon !== undefined ? { battleWon } : {}),
        },
        defs.hunting,
        { limits, items: defs.items, now: Date.now(), carryLimit: 100 },
      );
      setSaved(result);
      if (result.status !== "ok")
        reportError(fb, new Error(`사냥 저장: ${result.status}`), "사냥 저장");
    } catch (error) {
      reportError(fb, error, "사냥 저장");
      setSaved({ status: "rejected", detail: "저장하지 못했어요" });
    }
  };

  // 끝나면 저장 (달려든 짐승은 싸운 뒤에)
  useEffect(() => {
    if (state.phase === "끝" && state.outcome !== "달려듦") void save();
  }, [state.phase]);

  const fight = () => {
    const danger = hunt.prey.danger;
    if (!danger) return;
    try {
      const { ally } = allyOfCharacter(character, {
        ...defs.battle.practice,
        trees: [defs.battle.practice.tree],
      });
      const enemies = danger.enemies.map((m, i) => {
        const def = defs.battle.practice.enemies.find((e) => e.id === m.enemy);
        if (!def) throw new Error(`정의에 없는 적: ${m.enemy}`);
        return { id: `e${i}`, def, slot: m.slot };
      });
      setBattle({
        id: `hunt-${seed}`,
        kind: "일반",
        seed: `hunt-${seed}`,
        allies: [ally],
        enemies,
      });
    } catch (error) {
      reportError(fb, error, "사냥 전투 열기");
      setNotice("싸움을 열지 못했어요.");
    }
  };

  const again = () => {
    committed.current = false;
    setSeed(newSeed());
    setActions([]);
    setAiming(false);
    setNotice(undefined);
    setSaved(undefined);
    setBattle(undefined);
  };

  if (battle) {
    return (
      <BattleScreen
        fb={fb}
        defs={defs.battle}
        setup={battle}
        title={`사냥 · ${hunt.prey.name}`}
        onRetry={() => undefined}
        onExit={() => undefined}
        onFinish={(b: BattleState) => {
          setBattle(undefined);
          void save(b.outcome === "승리");
        }}
      />
    );
  }

  const fork = state.phase === "추적" ? hunt.forks[state.fork] : undefined;
  const alertLabel =
    state.alert >= 70
      ? "귀를 세웠다"
      : state.alert >= 35
        ? "주위를 살핀다"
        : "아직 눈치채지 못함";
  const seen = state.phase !== "추적";

  return (
    <main class="stage ht">
      <header class="bar">
        <div class="bar__inner">
          <h1 class="bar__title">사냥 — {ground.name}</h1>
          <div class="bar__side">
            <span class="ht__info">
              {season} · 오늘 {today}번 · 품질{" "}
              {steps === 0 ? "그대로" : `−${steps}단계`}
            </span>
            <button class="bar__button" type="button" onClick={props.onExit}>
              나가기
            </button>
          </div>
        </div>
      </header>

      <div class="ht__body">
        <Paper class="ht__scene" label="초원">
          <p class="ht__target">
            {seen
              ? `${hunt.prey.name} · ${alertLabel}`
              : `무언가의 흔적 · ${alertLabel}`}
          </p>
          <svg class="ht__svg" viewBox="0 0 800 400" aria-hidden="true">
            <rect width="800" height="400" fill="#b9b48a" />
            <rect width="800" height="150" fill="#cfd3c4" />
            <path
              d="M0 150 Q200 130 400 150 T800 145 L800 400 L0 400 Z"
              fill="#a5a06f"
            />
            {fork &&
              fork.paths.map((p) => {
                const end = {
                  북: [400, 160],
                  동: [760, 280],
                  남: [400, 395],
                  서: [40, 280],
                }[p.dir];
                return (
                  <path
                    key={p.dir}
                    class={`ht__road ${state.tried.includes(fork.paths.indexOf(p)) ? "ht__road--tried" : ""}`}
                    d={`M400 300 L${end[0]} ${end[1]}`}
                  />
                );
              })}
            {seen && (
              <ellipse
                class="ht__prey"
                cx="400"
                cy={230 + (1 - state.distance / rules.distance.start) * 60}
                rx={
                  30 +
                  (rules.distance.start - state.distance) * 1.6 +
                  hunt.prey.weight * 4
                }
                ry={14 + (rules.distance.start - state.distance) * 0.7}
              />
            )}
            {fork && (
              <text x="740" y="60" class="ht__wind">
                바람 {WIND_ARROW[fork.windFrom]}
              </text>
            )}
          </svg>
          <div class="ht__meters">
            <Meter
              label="경계"
              value={state.alert / 100}
              danger={state.alert >= 70}
            />
            <span class="ht__steps">
              {state.phase === "추적"
                ? `남은 걸음 ${state.halfSteps / 2}`
                : seen
                  ? `거리 ${state.distance}m`
                  : ""}
            </span>
          </div>
          {notice && <p class="ht__notice">{notice}</p>}
        </Paper>

        <div class="ht__side">
          {state.phase === "끝" ? (
            <Result
              state={state}
              saved={saved}
              preyName={hunt.prey.name}
              itemName={itemName}
              danger={hunt.prey.danger !== undefined}
              onFight={fight}
              onAgain={again}
              onExit={props.onExit}
            />
          ) : fork ? (
            <Paper class="ht__panel" label="갈림길">
              <h2 class="ht__title">
                갈림길 {state.fork + 1} / {hunt.forks.length}
              </h2>
              <p class="ht__hint">
                바람이 {fork.windFrom}쪽에서 불어온다.{" "}
                {fork.windFrom === "북"
                  ? "남"
                  : fork.windFrom === "남"
                    ? "북"
                    : fork.windFrom === "동"
                      ? "서"
                      : "동"}
                쪽으로 가면 바람을 등져 냄새가 간다.
              </p>
              <div class="ht__pace" role="radiogroup" aria-label="걸음">
                {(["조용히", "빠르게"] as const).map((p) => (
                  <button
                    key={p}
                    class="button button--small"
                    type="button"
                    role="radio"
                    aria-checked={pace === p}
                    onClick={() => setPace(p)}
                  >
                    {p}
                    {p === "빠르게" ? " (반 걸음, 소리 남)" : " (한 걸음)"}
                  </button>
                ))}
              </div>
              <ul class="ht__paths">
                {fork.paths.map((p, i) => (
                  <li key={p.dir}>
                    <button
                      class="button"
                      type="button"
                      disabled={state.tried.includes(i)}
                      onClick={() => add({ kind: "길", path: i, pace })}
                    >
                      {ARROWS[p.dir]} {p.dir}쪽 길 · {p.track}
                      {isDownwind(fork, p.dir) ? " · 바람을 등짐" : ""}
                      {state.tried.includes(i) ? " · 끊긴 흔적" : ""}
                    </button>
                  </li>
                ))}
              </ul>
              <p class="ht__known">
                처음 발견한 흔적: {hunt.startTrack}. 틀린 길은 흔적이 끊겨
                걸음만 써요.
              </p>
              <details class="ht__guide">
                <summary>이 초원의 짐승과 흔적</summary>
                <ul>
                  {ground.prey
                    .filter((p) => p.seasons.includes(season))
                    .map((p) => (
                      <li key={p.id}>
                        {p.name}: {p.tracks.join(" · ")}
                      </li>
                    ))}
                </ul>
              </details>
            </Paper>
          ) : (
            <Paper class="ht__panel" label="조준">
              <h2 class="ht__title">
                {withJosa(hunt.prey.name, "이", "가")} 보인다
              </h2>
              <p class="ht__hint">
                가까울수록 맞히기 쉽지만, 다가갈 때마다 경계가{" "}
                {approachAlert(hunt.prey, rules)} 오른다.
              </p>
              <div class="ht__actions">
                <button
                  class="button"
                  type="button"
                  disabled={state.distance <= rules.distance.min}
                  onClick={() => add({ kind: "다가가기" })}
                >
                  더 다가가기
                </button>
                <button
                  class="button button--main"
                  type="button"
                  onClick={() => setAiming(true)}
                >
                  쏘기
                </button>
              </div>
            </Paper>
          )}
        </div>
      </div>

      {aiming && state.phase === "조준" && (
        <Shot
          widths={barWidths(state.distance, rules)}
          sweepMs={rules.bar.sweepMs}
          runKey={`${seed}-${actions.length}`}
          onDone={(position) => {
            setAiming(false);
            add({ kind: "쏘기", position: position ?? null });
          }}
        />
      )}
    </main>
  );
}

function Shot(props: {
  widths: ReturnType<typeof barWidths>;
  sweepMs: number;
  runKey: string;
  onDone: (position: number | undefined) => void;
}) {
  const sweep = useSweep(props.runKey, props.sweepMs, BAR_LENGTH, props.onDone);
  return (
    <div
      class="judge"
      role="dialog"
      aria-label="판정 바"
      onPointerDown={sweep.press}
    >
      <div class="judge__inner">
        <p class="judge__title">숨을 고르고 쏜다</p>
        <Bar
          widths={props.widths}
          length={BAR_LENGTH}
          position={sweep.position}
        />
        <p class="judge__help">가운데 칸에서 누르세요 — 아무 데나</p>
      </div>
    </div>
  );
}

function Result(props: {
  state: ReturnType<typeof replayHunt>;
  saved: HuntingCommitResult | "saving" | undefined;
  preyName: string;
  itemName: (id: string) => string;
  danger: boolean;
  onFight: () => void;
  onAgain: () => void;
  onExit: () => void;
}) {
  const { state, saved } = props;
  const headline =
    state.outcome === "잡음"
      ? `${withJosa(props.preyName, "을", "를")} 잡았다!`
      : state.outcome === "달려듦"
        ? saved === undefined
          ? `${withJosa(props.preyName, "이", "가")} 달려든다!`
          : saved !== "saving" &&
              saved.status === "ok" &&
              saved.gains.length > 0
            ? `${withJosa(props.preyName, "을", "를")} 쓰러뜨렸다`
            : `${props.preyName}에게 밀려났다`
        : state.outcome === "놓침"
          ? "흔적을 놓쳤다"
          : `${withJosa(props.preyName, "이", "가")} 달아났다`;
  return (
    <Paper class="ht__panel" label="사냥 결과">
      <h2 class="ht__title">{headline}</h2>
      {state.judgement && <p class="ht__hint">판정: {state.judgement}</p>}
      {state.outcome === "달려듦" && saved === undefined ? (
        <div class="ht__actions">
          <button
            class="button button--main"
            type="button"
            onClick={props.onFight}
          >
            맞서 싸우기
          </button>
        </div>
      ) : saved === "saving" ? (
        <p>기록하는 중…</p>
      ) : saved?.status === "ok" ? (
        <ul class="ht__gains">
          {saved.gains.length === 0 && <li>얻은 것 없음</li>}
          {saved.gains.map((g) => (
            <li key={g.item}>
              {props.itemName(g.item)} ×{g.quantity} · {g.quality}
            </li>
          ))}
        </ul>
      ) : saved ? (
        <p class="ht__problem">기록하지 못했어요. 잠시 뒤 다시 해 주세요.</p>
      ) : null}
      {saved !== undefined && saved !== "saving" && (
        <div class="ht__actions">
          <button
            class="button button--main"
            type="button"
            onClick={props.onAgain}
          >
            다시 사냥
          </button>
          <button class="button" type="button" onClick={props.onExit}>
            돌아가기
          </button>
        </div>
      )}
    </Paper>
  );
}

function Meter(props: { label: string; value: number; danger?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, props.value)) * 100);
  return (
    <div
      class={`ht__meter ${props.danger ? "ht__meter--danger" : ""}`}
      role="meter"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span class="ht__meter-label">
        {props.label} {pct}
      </span>
      <span class="ht__meter-bar">
        <span class="ht__meter-fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** 받침이 있으면 앞의 조사, 없으면 뒤의 조사 (초원토끼를, 영양을) */
function withJosa(
  word: string,
  withFinal: string,
  withoutFinal: string,
): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
  return `${word}${hasFinal ? withFinal : withoutFinal}`;
}
