import { push, ref } from "firebase/database";
import { useMemo, useState } from "preact/hooks";
import rawGathering from "../../../data/defs/gathering.json";
import rawItems from "../../../data/defs/items.json";
import {
  commitGathering,
  GATHERING_FATIGUE,
  type GatheringCommitResult,
} from "../../data/gathering";
import type { Firebase } from "../../data/firebase-app";
import { firebasePort } from "../../data/firebase-port";
import { reportError, type Session } from "../../data/session";
import { parseMonthKey, seasonOf } from "../../rules/calendar";
import { fatigueMultiplier } from "../../rules/dungeon/end";
import { curveSteps } from "../../rules/fishing";
import {
  costOf,
  GatheringError,
  planField,
  replayGathering,
  type GatherAction,
  type Plant,
} from "../../rules/gathering";
import {
  GatheringDefsSchema,
  type GatheringDefs,
  type Tells,
} from "../../schema/defs/gathering";
import { ItemListSchema, type Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import { Notice, Paper } from "../parts";
import "./gathering.css";

type SignedIn = Extract<Session, { status: "signedIn" }>;
const SPOT_ID = "south-arm-slope";

const STEM_COLORS: Record<Tells["stem"], string> = {
  연두: "#7fa35a",
  자주: "#8a4f7d",
  갈색: "#7a5a3a",
};
const BACK_COLORS: Record<Tells["back"], string> = {
  은빛: "#c9d1cf",
  붉음: "#a5432f",
  연두: "#9cbf6b",
  솜털: "#e6e1d2",
};

/**
 * 채집 (docs/ui/Gather, 8단계 ② 나). 비가 오기 전에 비탈의 약초를 캔다. 닮은 독초가 섞여 있어
 * 줄기 색·잎 가장자리로 짐작하고, 「잎 뒤 보기」(시간이 든다)로 확인한다. 조심히 캐면 품질이 좋다.
 */
export function GatheringScreen(props: {
  fb: Firebase;
  limits: Limits;
  session: SignedIn;
  onExit: () => void;
}) {
  const defs = useMemo<
    { gathering: GatheringDefs; items: ReadonlyMap<string, Item> } | Error
  >(() => {
    try {
      return {
        gathering: GatheringDefsSchema.parse(rawGathering),
        items: new Map(
          ItemListSchema.parse(rawItems).items.map((i) => [i.id, i]),
        ),
      };
    } catch (error) {
      reportError(props.fb, error, "채집 정의 읽기");
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [props.fb]);
  const { character, characterId } = props.session;
  if (defs instanceof Error)
    return (
      <Notice title="채집">
        채집터 기록을 읽지 못했어요. 기록해 두었어요.
      </Notice>
    );
  if (!character || !characterId)
    return <Notice title="채집">열람증이 준비되면 채집할 수 있어요.</Notice>;
  if (!defs.gathering.spots.some((s) => s.id === SPOT_ID))
    return <Notice title="채집">채집터를 찾지 못했어요.</Notice>;
  return (
    <Gathering
      {...props}
      defs={defs}
      characterId={characterId}
      character={character}
    />
  );
}

function Gathering(props: {
  fb: Firebase;
  limits: Limits;
  onExit: () => void;
  defs: { gathering: GatheringDefs; items: ReadonlyMap<string, Item> };
  characterId: string;
  character: NonNullable<SignedIn["character"]>;
}) {
  const { fb, limits, defs, character, characterId } = props;
  const { rules } = defs.gathering;
  const spot = defs.gathering.spots.find((s) => s.id === SPOT_ID)!;
  const season = seasonOf(parseMonthKey(character.month.key)?.index ?? 0);
  const today = character.month.fatigue[GATHERING_FATIGUE] ?? 0;
  const steps = curveSteps(
    fatigueMultiplier(today + 1, limits),
    limits.dungeon.fatigueCurve,
  );
  const talents = character.talents;
  const herbNose =
    talents.chosen.includes("herb-nose") ||
    talents.innate === "herb-nose" ||
    talents.acquired["herb-nose"] === true;

  const newSeed = () =>
    push(ref(fb.db, "requests")).key ?? `field${Date.now()}`;
  const [seed, setSeed] = useState(newSeed);
  const field = useMemo(() => planField(seed, spot, season, rules), [seed]);
  const [actions, setActions] = useState<GatherAction[]>([]);
  const [selected, setSelected] = useState<number>();
  const [notice, setNotice] = useState<string>();
  const [saved, setSaved] = useState<GatheringCommitResult | "saving">();
  const state = useMemo(
    () => replayGathering(field, actions, rules, steps),
    [field, actions],
  );
  const plant = selected !== undefined ? field.plants[selected] : undefined;
  const itemName = (id: string) => defs.items.get(id)?.name ?? id;
  const ended = state.rained || saved !== undefined;

  const doAction = (kind: GatherAction["kind"]) => {
    if (!plant) return;
    const next = [...actions, { plant: plant.index, kind }];
    try {
      const after = replayGathering(field, next, rules, steps);
      setActions(next);
      if (kind !== "잎 뒤 보기") {
        const gain = after.gains.find((g) => g.plant === plant.index);
        setNotice(
          gain
            ? `${itemName(gain.item)} ×${gain.quantity} · 품질 ${gain.quality}`
            : `독초였다! ${plant.herb.lookalike?.name ?? ""}`,
        );
        setSelected(undefined);
      } else setNotice(undefined);
      if (after.rained) void finish(next);
    } catch (error) {
      if (error instanceof GatheringError) setNotice(error.message);
      else reportError(fb, error, "채집");
    }
  };

  const finish = async (done: GatherAction[]) => {
    setSaved("saving");
    try {
      const requestId =
        push(ref(fb.db, "requests")).key ?? `gather${Date.now()}`;
      const result = await commitGathering(
        firebasePort(fb.db),
        characterId,
        requestId,
        { spotId: spot.id, seed, actions: done },
        defs.gathering,
        {
          limits,
          items: defs.items,
          now: Date.now(),
          carryLimit: 100,
        },
      );
      setSaved(result);
      if (result.status !== "ok")
        reportError(fb, new Error(`채집 저장: ${result.status}`), "채집 저장");
    } catch (error) {
      reportError(fb, error, "채집 저장");
      setSaved({ status: "rejected", detail: "저장하지 못했어요" });
    }
  };

  const again = () => {
    setSeed(newSeed());
    setActions([]);
    setSelected(undefined);
    setNotice(undefined);
    setSaved(undefined);
  };

  return (
    <main class="stage gt">
      <header class="bar">
        <div class="bar__inner">
          <h1 class="bar__title">채집 — {spot.name}</h1>
          <div class="bar__side">
            <span class="gt__info">
              {season} · 오늘 {today}번 · 품질{" "}
              {steps === 0 ? "그대로" : `−${steps}단계`}
            </span>
            <button class="bar__button" type="button" onClick={props.onExit}>
              나가기
            </button>
          </div>
        </div>
      </header>

      <p class="gt__time" role="status">
        {state.rained
          ? "비가 쏟아진다. 내려가야 한다."
          : `비 오기 전 · 남은 시간 ${state.timeLeft} / ${rules.time}`}
      </p>

      <div class="gt__body">
        <Paper class="gt__slope" label="산비탈">
          <Slope
            plants={field.plants}
            state={state}
            selected={selected}
            ended={ended}
            timeLeft={state.timeLeft}
            time={rules.time}
            onPick={setSelected}
            itemName={itemName}
          />
          {notice && <p class="gt__notice">{notice}</p>}
        </Paper>

        <div class="gt__side">
          {saved !== undefined ? (
            <Summary
              saved={saved}
              state={state}
              itemName={itemName}
              onAgain={again}
              onExit={props.onExit}
            />
          ) : plant && !state.dug.includes(plant.index) ? (
            <Paper class="gt__close" label="가까이 보기">
              <h2 class="gt__title">{itemName(plant.herb.item)}?</h2>
              <CloseUp
                tells={plant.tells}
                showBack={state.checked.includes(plant.index)}
              />
              <dl class="gt__tells">
                <dt>줄기</dt>
                <dd>{plant.tells.stem}</dd>
                <dt>잎 가장자리</dt>
                <dd>{plant.tells.edge}</dd>
                <dt>잎 뒤</dt>
                <dd>
                  {state.checked.includes(plant.index)
                    ? plant.tells.back
                    : "아직 모름"}
                </dd>
              </dl>
              <p class="gt__known">
                알려진 {itemName(plant.herb.item)}: 줄기 {plant.herb.tells.stem}{" "}
                · 잎 가장자리 {plant.herb.tells.edge} · 잎 뒤{" "}
                {plant.herb.tells.back}
              </p>
              {herbNose && plant.poison && (
                <p class="gt__nose">약초의 코: 어딘가 꺼림칙한 냄새가 난다.</p>
              )}
              <div class="gt__actions">
                <button
                  class="button"
                  type="button"
                  disabled={
                    state.checked.includes(plant.index) ||
                    costOf("잎 뒤 보기", rules) > state.timeLeft
                  }
                  onClick={() => doAction("잎 뒤 보기")}
                >
                  잎 뒤 보기 · {rules.cost.back}
                </button>
                <button
                  class="button button--main"
                  type="button"
                  disabled={costOf("조심히 캐기", rules) > state.timeLeft}
                  onClick={() => doAction("조심히 캐기")}
                >
                  조심히 캐기 · {rules.cost.careful}
                </button>
                <button
                  class="button"
                  type="button"
                  disabled={costOf("빨리 뜯기", rules) > state.timeLeft}
                  onClick={() => doAction("빨리 뜯기")}
                >
                  빨리 뜯기 · {rules.cost.quick}
                </button>
                <button
                  class="button"
                  type="button"
                  onClick={() => setSelected(undefined)}
                >
                  두고 가기
                </button>
              </div>
            </Paper>
          ) : (
            <Paper class="gt__close" label="안내">
              <p class="gt__hint">
                비탈의 풀을 눌러 가까이 보세요. 비슷하게 생긴 독초가 섞여
                있어요. 잎 뒤가 다르면 독초예요.
              </p>
              <p class="gt__hint">{spot.description}</p>
            </Paper>
          )}

          <Paper class="gt__bag" label="캔 것">
            <h2 class="gt__subtitle">캔 것</h2>
            <ul class="gt__gains">
              {state.gains.length === 0 && <li>아직 없음</li>}
              {state.gains.map((g) => (
                <li key={g.plant}>
                  {itemName(g.item)} ×{g.quantity} · {g.quality}
                </li>
              ))}
              {state.wasted.length > 0 && (
                <li class="gt__wasted">
                  독초 {state.wasted.length}포기 (헛수고)
                </li>
              )}
            </ul>
            {saved === undefined && (
              <button
                class="button"
                type="button"
                onClick={() => void finish(actions)}
              >
                내려가기 (여기까지 정리)
              </button>
            )}
          </Paper>
        </div>
      </div>
    </main>
  );
}

function Summary(props: {
  saved: GatheringCommitResult | "saving";
  state: ReturnType<typeof replayGathering>;
  itemName: (id: string) => string;
  onAgain: () => void;
  onExit: () => void;
}) {
  const { saved } = props;
  return (
    <Paper class="gt__close" label="채집 정리">
      <h2 class="gt__title">
        {props.state.rained ? "비가 쏟아진다" : "산을 내려왔다"}
      </h2>
      {saved === "saving" ? (
        <p>가방에 넣는 중…</p>
      ) : saved.status === "ok" ? (
        <>
          <p>
            {props.state.gains.length > 0
              ? `약초 ${props.state.gains.reduce((sum, g) => sum + g.quantity, 0)}개를 가방에 넣었어요.`
              : "캔 약초가 없어요."}
            {saved.mailed.length > 0
              ? " 가방이 넘쳐 일부는 우편함으로 보냈어요."
              : ""}
          </p>
          {props.state.wasted.length > 0 && (
            <p class="gt__wasted">
              독초 {props.state.wasted.length}포기는 버렸어요.
            </p>
          )}
        </>
      ) : (
        <p class="gt__problem">기록하지 못했어요. 잠시 뒤 다시 해 주세요.</p>
      )}
      <div class="gt__actions">
        <button
          class="button button--main"
          type="button"
          disabled={saved === "saving"}
          onClick={props.onAgain}
        >
          다시 나가기
        </button>
        <button class="button" type="button" onClick={props.onExit}>
          돌아가기
        </button>
      </div>
    </Paper>
  );
}

/** 잎 하나의 모양: 매끈(타원) / 톱니 / 갈라짐(세 갈래) */
function Leaf(props: {
  x: number;
  y: number;
  size: number;
  edge: Tells["edge"];
  fill: string;
  flip?: boolean;
}) {
  const { x, y, size: s, edge, fill } = props;
  const transform = `translate(${x} ${y}) rotate(${props.flip ? 35 : -35})`;
  if (edge === "매끈")
    return <ellipse transform={transform} rx={s} ry={s * 0.42} fill={fill} />;
  if (edge === "톱니") {
    const pts: string[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * 2 - 1;
      const w = Math.sqrt(1 - t * t) * s * 0.42 * (i % 2 ? 1.25 : 0.85);
      pts.push(`${t * s},${-w}`);
    }
    for (let i = 10; i >= 0; i--) {
      const t = (i / 10) * 2 - 1;
      const w = Math.sqrt(1 - t * t) * s * 0.42 * (i % 2 ? 1.25 : 0.85);
      pts.push(`${t * s},${w}`);
    }
    return <polygon transform={transform} points={pts.join(" ")} fill={fill} />;
  }
  return (
    <g transform={transform} fill={fill}>
      <ellipse cx={s * 0.3} rx={s * 0.7} ry={s * 0.22} />
      <ellipse
        cx={s * 0.1}
        cy={-s * 0.25}
        rx={s * 0.5}
        ry={s * 0.18}
        transform="rotate(-30)"
      />
      <ellipse
        cx={s * 0.1}
        cy={s * 0.25}
        rx={s * 0.5}
        ry={s * 0.18}
        transform="rotate(30)"
      />
    </g>
  );
}

function PlantShape(props: {
  tells: Tells;
  x: number;
  y: number;
  scale: number;
  showBack?: boolean;
}) {
  const { tells, x, y, scale: k } = props;
  const leaf = "#6f9a4e";
  return (
    <g>
      <path
        d={`M${x} ${y} Q${x - 4 * k} ${y - 30 * k} ${x} ${y - 60 * k}`}
        stroke={STEM_COLORS[tells.stem]}
        stroke-width={3 * k}
        fill="none"
      />
      <Leaf
        x={x - 14 * k}
        y={y - 22 * k}
        size={16 * k}
        edge={tells.edge}
        fill={leaf}
      />
      <Leaf
        x={x + 14 * k}
        y={y - 40 * k}
        size={16 * k}
        edge={tells.edge}
        fill={props.showBack ? BACK_COLORS[tells.back] : leaf}
        flip
      />
      <Leaf
        x={x - 10 * k}
        y={y - 55 * k}
        size={12 * k}
        edge={tells.edge}
        fill={leaf}
      />
    </g>
  );
}

function CloseUp(props: { tells: Tells; showBack: boolean }) {
  return (
    <svg class="gt__closeup" viewBox="0 0 200 160" aria-hidden="true">
      <rect width="200" height="160" fill="#efe8d6" />
      <PlantShape
        tells={props.tells}
        x={100}
        y={150}
        scale={2.2}
        showBack={props.showBack}
      />
    </svg>
  );
}

/** 산비탈: 구름은 시간이 갈수록 짙어지고, 비가 오면 빗줄기. 풀을 누르면 가까이 본다 */
function Slope(props: {
  plants: Plant[];
  state: ReturnType<typeof replayGathering>;
  selected: number | undefined;
  ended: boolean;
  timeLeft: number;
  time: number;
  onPick: (index: number) => void;
  itemName: (id: string) => string;
}) {
  const dark = 1 - props.timeLeft / props.time;
  return (
    <svg
      class="gt__svg"
      viewBox="0 0 800 450"
      role="group"
      aria-label="산비탈의 풀"
    >
      <rect width="800" height="450" fill="#9aa7a8" />
      <rect
        width="800"
        height="160"
        fill="#3d4447"
        opacity={0.15 + dark * 0.7}
      />
      <path d="M0 150 L800 90 L800 450 L0 450 Z" fill="#6b7d55" />
      <path d="M0 260 L800 200 L800 450 L0 450 Z" fill="#5c6e48" />
      {props.plants.map((p) => {
        const x = 40 + p.x * 720;
        const y = 150 + p.y * 280;
        const dug = props.state.dug.includes(p.index);
        if (dug)
          return (
            <ellipse
              key={p.index}
              cx={x}
              cy={y}
              rx="16"
              ry="5"
              fill="#3b3226"
              opacity="0.7"
            />
          );
        const canPick = !props.ended;
        return (
          <g
            key={p.index}
            class={`gt__plant ${props.selected === p.index ? "gt__plant--picked" : ""}`}
            {...(canPick
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `풀 ${p.index + 1}: ${props.itemName(p.herb.item)}처럼 보이는 풀${props.state.checked.includes(p.index) ? " (잎 뒤 봄)" : ""}`,
                  onClick: () => props.onPick(p.index),
                  onKeyDown: (e: KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      props.onPick(p.index);
                    }
                  },
                }
              : {})}
          >
            <circle class="gt__plant-ring" cx={x} cy={y - 30} r="40" />
            <PlantShape
              tells={p.tells}
              x={x}
              y={y}
              scale={1}
              showBack={props.state.checked.includes(p.index)}
            />
          </g>
        );
      })}
      {props.state.rained &&
        Array.from({ length: 40 }, (_, i) => (
          <line
            key={i}
            x1={(i * 53) % 800}
            y1={(i * 37) % 450}
            x2={((i * 53) % 800) - 12}
            y2={((i * 37) % 450) + 30}
            class="gt__rain"
          />
        ))}
    </svg>
  );
}
