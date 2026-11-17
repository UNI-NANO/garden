import { push, ref } from "firebase/database";
import { useMemo, useRef, useState } from "preact/hooks";
import {
  enterDungeon,
  EXPLORE_FATIGUE,
  finishExpedition,
  saveExpedition,
  type FinishResult,
} from "../../data/dungeon";
import type { Firebase } from "../../data/firebase-app";
import { firebasePort } from "../../data/firebase-port";
import { reportError, type Session } from "../../data/session";
import { allyOfCharacter, allyVitals } from "../../rules/battle/ally-of";
import type { BattleSetup, BattleState } from "../../rules/battle/engine";
import { autoReturnDue, fatigueMultiplier } from "../../rules/dungeon/end";
import {
  blastWall,
  descend,
  DungeonError,
  exits,
  finishFight,
  move,
  pickups,
  take,
  useRest,
  usedSlots,
  type Expedition,
  type ExploreContext,
  type Gain,
} from "../../rules/dungeon/explore";
import {
  generateFloor,
  type Floor,
  type Pickup,
  type Room,
} from "../../rules/dungeon/floor";
import type { Dungeon } from "../../schema/defs/dungeon";
import type { Limits } from "../../schema/defs/limits";
import { fromStored } from "../../schema/expedition";
import { BattleScreen } from "../battle/BattleScreen";
import { Notice, Paper } from "../parts";
import { loadDungeonDefs, type DungeonDefs } from "./defs";
import "./dungeon.css";

type SignedIn = Extract<Session, { status: "signedIn" }>;

/** 지금은 국경 숲길 하나 (지도·이동이 생기면 입구가 있는 장소에서 고른다) */
const DUNGEON_ID = "border-forest";
const ORDINAL = [
  "첫째",
  "둘째",
  "셋째",
  "넷째",
  "다섯째",
  "여섯째",
  "일곱째",
  "여덟째",
  "아홉째",
  "열째",
];
const floorName = (n: number) => `${ORDINAL[n - 1] ?? `${n}번째`} 층`;

/**
 * 던전 (명세서 「던전」, docs/ui/DungeonGate·Dungeon). 혼자 탐험.
 * 입구 → 탐험(작은 지도·방·줍기·이동·쉼터·계단, 싸우는 방은 전투 화면) → 끝나면 정리(가방에 넣기).
 * 방을 옮기거나 주울 때마다 진행을 저장한다. 접속을 끊어도 그 자리에서 이어진다.
 */
export function DungeonScreen(props: {
  fb: Firebase;
  limits: Limits;
  session: SignedIn;
  onExit: () => void;
}) {
  const defs = useMemo<DungeonDefs | Error>(() => {
    try {
      return loadDungeonDefs();
    } catch (error) {
      reportError(props.fb, error, "던전 정의 읽기");
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [props.fb]);
  const { character, characterId } = props.session;
  if (defs instanceof Error)
    return (
      <Notice title="던전">던전 기록을 읽지 못했어요. 기록해 두었어요.</Notice>
    );
  if (!character || !characterId)
    return <Notice title="던전">열람증이 준비되면 들어갈 수 있어요.</Notice>;
  const dungeon = defs.dungeons.get(DUNGEON_ID);
  if (!dungeon) return <Notice title="던전">던전을 찾지 못했어요.</Notice>;
  return (
    <DungeonRun
      {...props}
      defs={defs}
      dungeon={dungeon}
      characterId={characterId}
      character={character}
    />
  );
}

function DungeonRun(props: {
  fb: Firebase;
  limits: Limits;
  session: SignedIn;
  onExit: () => void;
  defs: DungeonDefs;
  dungeon: Dungeon;
  characterId: string;
  character: NonNullable<SignedIn["character"]>;
}) {
  const { fb, limits, defs, dungeon, character, characterId } = props;
  const db = useMemo(() => firebasePort(fb.db), [fb]);
  const [run, setRun] = useState<{ id: string; state: Expedition } | undefined>(
    () => (character.expedition ? fromStored(character.expedition) : undefined),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [fight, setFight] = useState<BattleSetup>();
  const [result, setResult] =
    useState<Extract<FinishResult, { status: "ok" }>>();
  const saving = useRef(Promise.resolve());

  const talents = character.talents;
  const seesCracks =
    talents.chosen.includes("tact") ||
    talents.innate === "tact" ||
    talents.acquired["tact"] === true;
  const ctx: ExploreContext = { limits, items: defs.items, seesCracks };
  const floor = useMemo(
    () =>
      run
        ? generateFloor(
            dungeon,
            run.state.floor,
            run.state.seed,
            defs.items,
            fatigueMultiplier(run.state.fatigueIndex, limits),
          )
        : undefined,
    [run?.state.floor, run?.state.seed, run?.state.fatigueIndex],
  );
  const fail = (
    error: unknown,
    where: string,
    text = "지금은 할 수 없어요. 잠시 뒤 다시 해 주세요.",
  ) => {
    if (error instanceof DungeonError) return setProblem(error.message);
    reportError(fb, error, where);
    setProblem(text);
  };

  /** 한 걸음: 계산하고, 화면을 바꾸고, 저장한다(저장은 순서대로) */
  const step = (action: (state: Expedition, floor: Floor) => Expedition) => {
    if (!run || !floor) return;
    setProblem(undefined);
    let next: Expedition;
    try {
      next = action(run.state, floor);
    } catch (error) {
      return fail(error, "던전 진행");
    }
    const id = run.id;
    setRun({ id, state: next });
    saving.current = saving.current.then(async () => {
      try {
        if ((await saveExpedition(db, characterId, id, next)) !== "ok")
          setProblem("진행을 저장하지 못했어요. 새로 고쳐 주세요.");
      } catch (error) {
        fail(error, "던전 저장", "진행을 저장하지 못했어요. 새로 고쳐 주세요.");
      }
    });
  };

  const enter = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const requestId = push(ref(fb.db, "requests")).key ?? `d${Date.now()}`;
      const vitals = allyVitals(character, defs.battle.practice);
      const entered = await enterDungeon(
        db,
        characterId,
        requestId,
        { dungeon, seed: requestId, ...vitals },
        { limits, items: defs.items, now: Date.now() },
      );
      if (entered.status === "ok" && entered.expedition) {
        setResult(undefined);
        setRun({ id: requestId, state: entered.expedition });
      } else
        setProblem(
          entered.status === "rejected"
            ? `들어가지 못했어요: ${entered.detail}`
            : "들어가지 못했어요. 잠시 뒤 다시 해 주세요.",
        );
    } catch (error) {
      fail(error, "던전 들어가기");
    } finally {
      setBusy(false);
    }
  };

  const settle = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      await saving.current;
      const requestId = push(ref(fb.db, "requests")).key ?? `f${Date.now()}`;
      const done = await finishExpedition(
        db,
        characterId,
        requestId,
        defs.dungeons,
        { limits, items: defs.items, now: Date.now(), carryLimit: 100 },
      );
      if (done.status === "ok") {
        setResult(done);
        setRun(undefined);
      } else if (done.status === "none") setRun(undefined);
      else
        setProblem(
          done.status === "rejected"
            ? `정리하지 못했어요: ${done.detail}`
            : "정리하지 못했어요. 잠시 뒤 다시 해 주세요.",
        );
    } catch (error) {
      fail(error, "던전 정리");
    } finally {
      setBusy(false);
    }
  };

  const startFight = (room: Room) => {
    if (!run || !room.group) return;
    try {
      const { ally, problems } = allyOfCharacter(
        character,
        { ...defs.battle.practice, trees: [defs.battle.practice.tree] },
        { hp: run.state.hp, energy: run.state.energy },
      );
      if (problems.length > 0)
        reportError(fb, new Error(problems.join(" / ")), "던전 전투 장착");
      const id = `${run.id}-f${run.state.floor}-r${room.index}`;
      const enemies = room.group.enemies.map((m, i) => {
        const def = defs.enemies.get(m.enemy);
        if (!def) throw new Error(`정의에 없는 적: ${m.enemy}`);
        return { id: `e${i}`, def, slot: m.slot };
      });
      setFight({
        id,
        kind:
          room.kind === "정예"
            ? "정예"
            : room.kind === "보스"
              ? "보스"
              : "일반",
        seed: id,
        allies: [ally],
        enemies,
      });
    } catch (error) {
      fail(error, "던전 전투 열기");
    }
  };

  const endFight = (battle: BattleState) => {
    const player = battle.allies.find((a) => a.kind === "플레이어");
    setFight(undefined);
    step((state, f) =>
      finishFight(
        state,
        f,
        {
          outcome: battle.outcome === "승리" ? "승리" : "패배",
          hp: player?.hp ?? 0,
          energy: player?.energy ?? 0,
        },
        ctx,
      ),
    );
  };

  if (fight && run) {
    return (
      <BattleScreen
        fb={fb}
        defs={defs.battle}
        setup={fight}
        title={`${dungeon.name} · ${floorName(run.state.floor)}`}
        onRetry={() => undefined}
        onExit={() => undefined}
        onFinish={endFight}
      />
    );
  }

  const header = (
    <header class="bar">
      <div class="bar__inner">
        <h1 class="bar__title">
          {run
            ? `${dungeon.name} · ${floorName(run.state.floor)} / ${dungeon.floors.length}`
            : "던전 입구"}
        </h1>
        <div class="bar__side">
          <button class="bar__button" type="button" onClick={props.onExit}>
            나가기
          </button>
        </div>
      </div>
    </header>
  );
  const notice = problem && (
    <p class="dg__problem" role="alert">
      {problem}
    </p>
  );

  if (!run || !floor) {
    return (
      <main class="stage dg">
        {header}
        {notice}
        {result ? (
          <Settled
            result={result}
            defs={defs}
            onBack={() => setResult(undefined)}
          />
        ) : (
          <Gate
            dungeon={dungeon}
            defs={defs}
            character={character}
            limits={limits}
            busy={busy}
            onEnter={() => void enter()}
          />
        )}
      </main>
    );
  }

  const { state } = run;
  const ended =
    state.status !== "탐험" || autoReturnDue(state, Date.now(), limits);
  const room = floor.rooms[state.at]!;
  const roomState = state.rooms[state.at] ?? {};
  const here = pickups(state, floor);
  const free = !ended && state.fight === undefined;
  const crackHere =
    room.secret !== undefined &&
    seesCracks &&
    !state.rooms[room.secret]?.cleared;

  return (
    <main class="stage dg">
      {header}
      {notice}
      <div class="dg__body">
        <Paper class="dg__map" label="던전 지도">
          <h2 class="dg__map-title">
            {floorName(state.floor)} · 들어간 방{" "}
            {Object.values(state.rooms).filter((r) => r.entered).length} /{" "}
            {floor.rooms.length}
          </h2>
          <DungeonMap
            floor={floor}
            state={state}
            seesCracks={seesCracks}
            canAct={free}
            onMove={(to) => step((s, f) => move(s, f, to, ctx))}
            onBlast={() => step((s, f) => blastWall(s, f, ctx))}
          />
          <p class="dg__legend">
            이어진 방을 눌러 옮겨 가요 · ▭ 문 · 🔒 잠긴 문(열쇠) · ⚡ 금 간
            벽(폭약) · ♨ 쉼터 · ✦ 끝방
          </p>
        </Paper>

        <div class="dg__side">
          <Paper class="dg__room" label="지금 있는 방">
            <h2 class="dg__room-title">
              {roomTitle(room)}
              {roomState.cleared &&
              (room.kind === "전투" ||
                room.kind === "정예" ||
                room.kind === "보스")
                ? " · 정리됨"
                : ""}
            </h2>
            <p class="dg__room-text">
              {roomText(room, roomState.cleared === true, state, floor)}
            </p>
            <p class="dg__vitals">
              체력 {state.hp}/{state.maxHp} · 기력 {state.energy}/
              {state.maxEnergy}
              <br />
              열쇠 {state.keys} · 폭약 {state.bombs} · 압박 {state.pressure}
            </p>

            {ended ? (
              <div class="dg__end">
                <p>
                  {endText(state, autoReturnDue(state, Date.now(), limits))}
                </p>
                <button
                  class="button button--main"
                  type="button"
                  disabled={busy}
                  onClick={() => void settle()}
                >
                  정리하기
                </button>
              </div>
            ) : state.fight !== undefined ? (
              <div class="dg__actions">
                <p>문이 닫혔다. 이겨야 열린다.</p>
                <button
                  class="button button--main"
                  type="button"
                  onClick={() => startFight(room)}
                >
                  싸우기
                </button>
              </div>
            ) : (
              <>
                {here.length > 0 && (
                  <ul class="dg__loot" aria-label="주울 것">
                    {here.map(({ index, pickup }) => (
                      <li key={index}>
                        <span>{pickupLabel(pickup, defs)}</span>
                        <button
                          class="button button--small"
                          type="button"
                          onClick={() => step((s, f) => take(s, f, index, ctx))}
                        >
                          줍기
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {crackHere && (
                  <p class="dg__crack">
                    벽에 금이 가 있다. 지도에서 금 간 벽을 누르면 폭약을 써요.
                  </p>
                )}
                {room.kind === "쉼터" && !state.restUsed && (
                  <div class="dg__actions">
                    <button
                      class="button"
                      type="button"
                      onClick={() => step((s, f) => useRest(s, f, "쉬기", ctx))}
                    >
                      쉬기
                    </button>
                    <button
                      class="button"
                      type="button"
                      onClick={() => step((s, f) => useRest(s, f, "귀환", ctx))}
                    >
                      귀환 (전부 가져감)
                    </button>
                  </div>
                )}
                {state.at === floor.end && state.stairs && !floor.last && (
                  <div class="dg__actions">
                    <button
                      class="button button--main"
                      type="button"
                      onClick={() =>
                        step((s, f) =>
                          descend(
                            s,
                            f,
                            generateFloor(
                              dungeon,
                              s.floor + 1,
                              s.seed,
                              defs.items,
                              fatigueMultiplier(s.fatigueIndex, limits),
                            ),
                          ),
                        )
                      }
                    >
                      다음 층으로 내려가기
                    </button>
                  </div>
                )}
              </>
            )}
          </Paper>
          <Paper class="dg__bag" label="던전 가방">
            <h2 class="dg__side-title">
              던전 가방 {usedSlots(state.gains)} / {limits.dungeon.lootSlots} 칸
            </h2>
            <ul class="dg__gains">
              {state.gains.length === 0 && <li>아직 없음</li>}
              {state.gains.map((gain, i) => (
                <li key={i}>{gainLabel(gain, defs)}</li>
              ))}
            </ul>
            <p class="dg__note">
              쉼터에서 귀환해야 다 가져가요. 쓰러지면 절반을 잃어요.
            </p>
          </Paper>
        </div>
      </div>
    </main>
  );
}

function Gate(props: {
  dungeon: Dungeon;
  defs: DungeonDefs;
  character: NonNullable<SignedIn["character"]>;
  limits: Limits;
  busy: boolean;
  onEnter: () => void;
}) {
  const { dungeon } = props;
  const today = props.character.month.fatigue[EXPLORE_FATIGUE] ?? 0;
  const rate = Math.round(fatigueMultiplier(today + 1, props.limits) * 100);
  const boss = dungeon.groups.보스[0]?.enemies
    .map((m) => props.defs.enemies.get(m.enemy))
    .find((e) => e?.rank === "보스");
  const specials = [
    ...new Set(
      Object.values(dungeon.loot).flatMap((t) =>
        t.entries.flatMap((e) =>
          e.kind === "물건"
            ? [props.defs.items.get(e.item)?.name ?? e.item]
            : [],
        ),
      ),
    ),
  ];
  return (
    <Paper class="dg__gate" label="던전 입구">
      <p class="dg__where">
        {dungeon.region} · 던전 · {dungeon.floors.length}층까지 · 들어갈 때마다
        새로 짜임
      </p>
      <h2 class="dg__gate-title">{dungeon.name}</h2>
      <p>{dungeon.description}</p>
      <dl class="dg__facts">
        <dt>압박</dt>
        <dd>
          {dungeon.pressure === "없음" ? "없음 (입문용)" : dungeon.pressure}
        </dd>
        <dt>얻는 것</dt>
        <dd>{specials.join(" · ")}</dd>
        <dt>보스</dt>
        <dd>{boss?.name ?? "?"}</dd>
        <dt>오늘 피로</dt>
        <dd>
          {today} · 이번 보상 {rate}%
        </dd>
      </dl>
      <p class="dg__note">
        쓰러지면 이번에 얻은 것의 절반을 잃어요 · 쉼터에서 귀환하면 전부
      </p>
      <button
        class="button button--main"
        type="button"
        disabled={props.busy}
        onClick={props.onEnter}
      >
        들어가기
      </button>
    </Paper>
  );
}

function Settled(props: {
  result: Extract<FinishResult, { status: "ok" }>;
  defs: DungeonDefs;
  onBack: () => void;
}) {
  const { settlement, firstClear, mailed } = props.result;
  return (
    <Paper class="dg__gate" label="탐험 정리">
      <h2 class="dg__gate-title">탐험 정리</h2>
      <h3>가방에 넣은 것</h3>
      <ul class="dg__gains">
        {settlement?.kept.length === 0 && <li>없음</li>}
        {settlement?.kept.map((g, i) => (
          <li key={i}>{gainLabel(g, props.defs)}</li>
        ))}
      </ul>
      {firstClear && <p>첫 클리어 보상도 받았어요.</p>}
      {(mailed?.length ?? 0) > 0 && (
        <p>가방이 넘쳐 일부는 우편함으로 보냈어요.</p>
      )}
      {(settlement?.lost.length ?? 0) > 0 && (
        <>
          <h3>잃은 것</h3>
          <ul class="dg__gains dg__gains--lost">
            {settlement?.lost.map((g, i) => (
              <li key={i}>{gainLabel(g, props.defs)}</li>
            ))}
          </ul>
        </>
      )}
      <button class="button" type="button" onClick={props.onBack}>
        입구로
      </button>
    </Paper>
  );
}

const UNIT = 100;
const ROOM = 70;
const GAP = UNIT - ROOM;
const DIR_NAMES = { 북: "북쪽", 남: "남쪽", 동: "동쪽", 서: "서쪽" } as const;
const dirOf = (from: Room, to: Room): keyof typeof DIR_NAMES =>
  to.x > from.x ? "동" : to.x < from.x ? "서" : to.y < from.y ? "북" : "남";

type Door = { a: Room; b: Room; kind: "문" | "잠긴 문" | "금 간 벽" };

/**
 * 던전 지도 (밝혀진 방만). 방과 방 사이 벽에 작은 문 칸: 문 / 잠긴 문(보물방, 열쇠) / 금 간 벽(비밀방, 눈치가 있을 때, 폭약).
 * 지금 방과 이어진 방을 누르면 옮겨 간다. 지금 방의 금 간 벽을 누르면 폭약을 쓴다.
 */
function DungeonMap(props: {
  floor: Floor;
  state: Expedition;
  seesCracks: boolean;
  canAct: boolean;
  onMove: (to: number) => void;
  onBlast: () => void;
}) {
  const { floor, state } = props;
  const roomState = (r: Room) => state.rooms[r.index] ?? {};
  const shown = floor.rooms.filter((r) => roomState(r).seen);
  const here = floor.rooms[state.at]!;
  const reachable = new Set(props.canAct ? exits(state, floor) : []);

  const doors: Door[] = [];
  for (const r of shown) {
    for (const to of r.doors) {
      const other = floor.rooms[to]!;
      if (
        to < r.index ||
        !roomState(other).seen ||
        !(roomState(r).entered || roomState(other).entered)
      )
        continue;
      const locked = [r, other].find(
        (x) => x.kind === "보물" && !roomState(x).cleared,
      );
      doors.push({ a: r, b: other, kind: locked ? "잠긴 문" : "문" });
    }
    if (r.secret !== undefined && roomState(r).entered) {
      const secret = floor.rooms[r.secret]!;
      if (roomState(secret).cleared)
        doors.push({ a: r, b: secret, kind: "문" });
      else if (props.seesCracks)
        doors.push({ a: r, b: secret, kind: "금 간 벽" });
    }
  }

  const all = [...shown, ...doors.map((d) => d.b)];
  const minX = Math.min(...all.map((r) => r.x));
  const minY = Math.min(...all.map((r) => r.y));
  const maxX = Math.max(...all.map((r) => r.x));
  const maxY = Math.max(...all.map((r) => r.y));
  const px = (x: number) => (x - minX) * UNIT + GAP / 2;
  const py = (y: number) => (y - minY) * UNIT + GAP / 2;
  const width = (maxX - minX + 1) * UNIT;
  const height = (maxY - minY + 1) * UNIT;

  const activate = (handler: () => void) => ({
    onClick: handler,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    },
  });

  return (
    <svg
      class="dg__svg"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label="던전 지도"
      style={{ maxWidth: `${width * 1.3}px` }}
    >
      {doors.map((door) => {
        const horizontal = door.a.y === door.b.y;
        const [left, top] = horizontal
          ? [
              px(Math.max(door.a.x, door.b.x)) - GAP - 2,
              py(door.a.y) + ROOM / 2 - 11,
            ]
          : [
              px(door.a.x) + ROOM / 2 - 11,
              py(Math.max(door.a.y, door.b.y)) - GAP - 2,
            ];
        const [w, h] = horizontal ? [GAP + 4, 22] : [22, GAP + 4];
        const crackHere =
          door.kind === "금 간 벽" && door.a.index === state.at && props.canAct;
        const cls = `dg__door dg__door--${door.kind === "문" ? "open" : door.kind === "잠긴 문" ? "locked" : "crack"}`;
        return (
          <g
            key={`${door.a.index}-${door.b.index}`}
            class={`${cls} ${crackHere ? "dg__door--act" : ""}`}
            {...(crackHere
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `${DIR_NAMES[dirOf(door.a, door.b)]} 금 간 벽 부수기 (폭약 ${state.bombs})`,
                  ...activate(props.onBlast),
                }
              : {})}
          >
            <rect x={left} y={top} width={w} height={h} rx="3" />
            {door.kind !== "문" && (
              <text
                x={left + w / 2}
                y={top + h / 2 + 5}
                text-anchor="middle"
                class="dg__door-mark"
              >
                {door.kind === "잠긴 문" ? "🔒" : "⚡"}
              </text>
            )}
          </g>
        );
      })}
      {shown.map((r) => {
        const s = roomState(r);
        const isHere = r.index === state.at;
        const canGo = reachable.has(r.index);
        const name = s.entered
          ? roomTitle(r)
          : r.kind === "보물"
            ? "잠긴 방"
            : "방";
        const mark = isHere
          ? "●"
          : r.kind === "쉼터"
            ? "♨"
            : r.index === floor.end
              ? "✦"
              : r.kind === "보물" && s.cleared
                ? "✧"
                : "";
        const cls = `dg__cell ${isHere ? "dg__cell--here" : s.entered ? "dg__cell--entered" : "dg__cell--seen"} ${canGo ? "dg__cell--go" : ""}`;
        return (
          <g
            key={r.index}
            class={cls}
            {...(canGo
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `${DIR_NAMES[dirOf(here, r)]} ${name}으로 가기`,
                  ...activate(() => props.onMove(r.index)),
                }
              : {})}
          >
            <rect x={px(r.x)} y={py(r.y)} width={ROOM} height={ROOM} rx="4" />
            {mark && (
              <text
                x={px(r.x) + ROOM / 2}
                y={py(r.y) + ROOM / 2 + 8}
                text-anchor="middle"
                class="dg__cell-mark"
              >
                {mark}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const ROOM_TITLES: Record<Room["kind"], string> = {
  시작: "시작방",
  쉼터: "쉼터방",
  전투: "전투방",
  함정: "함정방",
  보물: "보물방",
  비밀: "비밀방",
  정예: "정예방",
  보스: "보스방",
};
const roomTitle = (room: Room) => ROOM_TITLES[room.kind];

function roomText(
  room: Room,
  cleared: boolean,
  state: Expedition,
  floor: Floor,
): string {
  switch (room.kind) {
    case "시작":
      return "들어온 곳. 숲길이 여러 갈래로 뻗어 있다.";
    case "쉼터":
      return state.restUsed
        ? "사냥꾼 오두막. 이 층에서는 이미 쉬었다."
        : "사냥꾼 오두막. 한 번 쉬거나, 여기서 돌아갈 수 있다.";
    case "함정":
      return "덫이 놓여 있던 자리. 지나며 상처를 입었다.";
    case "보물":
      return "자물쇠가 풀린 상자들.";
    case "비밀":
      return "무너진 벽 너머 숨은 방.";
    case "전투":
      return cleared
        ? "싸움이 끝났다. 이제 지나다닐 수 있다."
        : "짐승들이 길을 막고 있다.";
    case "정예":
      return cleared
        ? "문지기가 쓰러졌다. 아래로 내려가는 계단이 열렸다."
        : "이 층의 문지기가 버티고 있다.";
    case "보스":
      return cleared
        ? "숲의 주인이 쓰러졌다."
        : `숲길의 끝. ${floor.last ? "보스가 기다린다." : ""}`;
  }
}

function endText(state: Expedition, auto: boolean): string {
  if (auto && state.status === "탐험")
    return "하루가 지나 자동으로 돌아왔어요. 얻은 것은 전부 가져가요.";
  if (state.status === "귀환")
    return "쉼터에서 돌아가기로 했어요. 얻은 것은 전부 가져가요.";
  if (state.status === "보스")
    return "보스를 쓰러뜨렸어요! 얻은 것을 전부 가지고 돌아가요.";
  return "쓰러져 밖으로 쫓겨났어요. 얻은 것의 절반을 잃어요.";
}

function pickupLabel(pickup: Pickup, defs: DungeonDefs): string {
  if (pickup.kind === "열쇠") return "열쇠";
  if (pickup.kind === "폭약") return "폭약";
  if (pickup.kind === "잎전") return `잎전 ${pickup.quantity}`;
  return `${defs.items.get(pickup.item)?.name ?? pickup.item} ×${pickup.quantity}`;
}

function gainLabel(gain: Gain, defs: DungeonDefs): string {
  if (gain.kind === "잎전") return `잎전 ${gain.quantity}`;
  const name = defs.items.get(gain.item)?.name ?? gain.item;
  return gain.kind === "묶음" ? `${name} ×${gain.quantity}` : name;
}
