import { push, ref } from "firebase/database";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import rawFishing from "../../../data/defs/fishing.json";
import rawItems from "../../../data/defs/items.json";
import {
  commitFishing,
  FISHING_FATIGUE,
  type FishingCommitResult,
  type FishingOutcome,
} from "../../data/fishing";
import type { Firebase } from "../../data/firebase-app";
import { firebasePort } from "../../data/firebase-port";
import { reportError, type Session } from "../../data/session";
import { parseMonthKey, seasonOf } from "../../rules/calendar";
import { fatigueMultiplier } from "../../rules/dungeon/end";
import {
  bobberAt,
  castPower,
  castZone,
  curveSteps,
  planCast,
  startFight,
  stepFight,
  strike,
  surgeAt,
  type Cast,
  type Fight,
} from "../../rules/fishing";
import { FishingDefsSchema, type FishingDefs } from "../../schema/defs/fishing";
import { ItemListSchema, type Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import { Notice } from "../parts";
import "./fishing.css";

type SignedIn = Extract<Session, { status: "signedIn" }>;

type Phase =
  | { kind: "준비" }
  | { kind: "힘"; heldAt: number }
  | { kind: "기다림"; cast: Cast; power: number; seed: string; castAt: number }
  | {
      kind: "씨름";
      cast: Cast;
      power: number;
      seed: string;
      fight: Fight;
      accuracy: number;
      last: number;
    }
  | {
      kind: "결과";
      cast: Cast;
      outcome: FishingOutcome;
      reason: string;
      saved?: FishingCommitResult;
      revealed: boolean;
    };

const SPOT_ID = "ostren-marsh";
const STEP_MS = 50;

/**
 * 낚시 (docs/ui/Fish, 8단계 ② 가). 화면 아무 데나(또는 스페이스) 누르는 방식(명세서 「UI와 모바일」 10번).
 * 던지기: 누르고 있으면 힘이 오가고, 떼면 던진다 → 기다리기: 톡톡은 참고, 푹 잠기면 누른다 →
 * 씨름: 누르고 있으면 감고, 떼면 푼다(차고 나갈 때는 풀어 줘야 줄이 버틴다) → 결과.
 */
export function FishingScreen(props: {
  fb: Firebase;
  limits: Limits;
  session: SignedIn;
  onExit: () => void;
}) {
  const defs = useMemo<
    { fishing: FishingDefs; items: ReadonlyMap<string, Item> } | Error
  >(() => {
    try {
      return {
        fishing: FishingDefsSchema.parse(rawFishing),
        items: new Map(
          ItemListSchema.parse(rawItems).items.map((i) => [i.id, i]),
        ),
      };
    } catch (error) {
      reportError(props.fb, error, "낚시 정의 읽기");
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [props.fb]);
  const { character, characterId } = props.session;
  if (defs instanceof Error)
    return (
      <Notice title="낚시">
        낚시터 기록을 읽지 못했어요. 기록해 두었어요.
      </Notice>
    );
  if (!character || !characterId)
    return <Notice title="낚시">열람증이 준비되면 낚시할 수 있어요.</Notice>;
  const spot = defs.fishing.spots.find((s) => s.id === SPOT_ID);
  if (!spot) return <Notice title="낚시">낚시터를 찾지 못했어요.</Notice>;
  return (
    <Fishing
      {...props}
      defs={defs}
      characterId={characterId}
      character={character}
    />
  );
}

function Fishing(props: {
  fb: Firebase;
  limits: Limits;
  onExit: () => void;
  defs: { fishing: FishingDefs; items: ReadonlyMap<string, Item> };
  characterId: string;
  character: NonNullable<SignedIn["character"]>;
}) {
  const { fb, limits, defs, character, characterId } = props;
  const { rules } = defs.fishing;
  const spot = defs.fishing.spots.find((s) => s.id === SPOT_ID)!;
  const season = seasonOf(parseMonthKey(character.month.key)?.index ?? 0);
  const today = character.month.fatigue[FISHING_FATIGUE] ?? 0;
  const nextSteps = curveSteps(
    fatigueMultiplier(today + 1, limits),
    limits.dungeon.fatigueCurve,
  );

  const [phase, setPhase] = useState<Phase>({ kind: "준비" });
  const [now, setNow] = useState(() => performance.now());
  const holding = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  /** 한 번 던진 결과는 한 번만 기록한다: 다음 프레임이 화면보다 먼저 와도 겹치지 않게 바로 바꿔 둔다 */
  const finish = (
    cast: Cast,
    outcome: FishingOutcome,
    reason: string,
    power: number,
    seed: string,
  ) => {
    if (phaseRef.current.kind === "결과") return;
    const next: Phase = {
      kind: "결과",
      cast,
      outcome,
      reason,
      revealed: false,
    };
    phaseRef.current = next;
    setPhase(next);
    const requestId = push(ref(fb.db, "requests")).key ?? `fish${Date.now()}`;
    commitFishing(
      firebasePort(fb.db),
      characterId,
      requestId,
      { spotId: spot.id, seed, power, outcome },
      defs.fishing,
      {
        limits,
        items: defs.items,
        now: Date.now(),
        carryLimit: 100,
      },
    )
      .then((saved) =>
        setPhase((p) => (p.kind === "결과" ? { ...p, saved } : p)),
      )
      .catch((error: unknown) => {
        reportError(fb, error, "낚시 저장");
        setPhase((p) =>
          p.kind === "결과"
            ? {
                ...p,
                saved: { status: "rejected", detail: "저장하지 못했어요" },
              }
            : p,
        );
      });
  };

  // 한 프레임마다: 힘 막대, 찌, 씨름을 흘려 보낸다
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const t = performance.now();
      setNow(t);
      const p = phaseRef.current;
      if (
        p.kind === "기다림" &&
        t - p.castAt > p.cast.biteAt + rules.biteWindowMs
      ) {
        finish(
          p.cast,
          { kind: "놓침" },
          "찌가 잠겼다 올라왔다. 너무 늦었다.",
          p.power,
          p.seed,
        );
      } else if (p.kind === "씨름") {
        let fight = p.fight;
        let last = p.last;
        while (t - last >= STEP_MS && !fight.outcome) {
          fight = stepFight(fight, p.cast, holding.current, STEP_MS, rules);
          last += STEP_MS;
        }
        if (fight.outcome === "낚음")
          finish(
            p.cast,
            {
              kind: "낚음",
              accuracy: p.accuracy,
              maxTension: fight.maxTension,
            },
            "낚았다!",
            p.power,
            p.seed,
          );
        else if (fight.outcome)
          finish(
            p.cast,
            { kind: fight.outcome },
            fight.outcome === "끊어짐"
              ? "줄이 끊어졌다."
              : "고기가 줄을 끌고 빠져나갔다.",
            p.power,
            p.seed,
          );
        else if (fight !== p.fight) {
          const next: Phase = { ...p, fight, last };
          phaseRef.current = next;
          setPhase(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // 결과: 실루엣이 먼저, 잠시 뒤 이름·크기
  useEffect(() => {
    if (phase.kind !== "결과" || phase.revealed) return;
    const timer = setTimeout(
      () => setPhase((p) => (p.kind === "결과" ? { ...p, revealed: true } : p)),
      900,
    );
    return () => clearTimeout(timer);
  }, [phase.kind === "결과" && !phase.revealed]);

  const press = () => {
    holding.current = true;
    const p = phaseRef.current;
    const t = performance.now();
    if (p.kind === "준비") {
      const next: Phase = { kind: "힘", heldAt: t };
      phaseRef.current = next;
      setPhase(next);
    } else if (p.kind === "기다림") {
      const result = strike(p.cast, t - p.castAt, rules);
      if (result.kind === "걸림") {
        const next: Phase = {
          kind: "씨름",
          cast: p.cast,
          power: p.power,
          seed: p.seed,
          fight: startFight(p.cast),
          accuracy: result.accuracy,
          last: t,
        };
        phaseRef.current = next;
        setPhase(next);
      } else
        finish(
          p.cast,
          { kind: "놓침" },
          "찌가 잠기기 전에 채었다. 고기가 놀라 달아났다.",
          p.power,
          p.seed,
        );
    }
  };
  const release = () => {
    holding.current = false;
    const p = phaseRef.current;
    if (p.kind === "힘") {
      const power = castPower(performance.now() - p.heldAt, rules);
      const seed = push(ref(fb.db, "requests")).key ?? `cast${Date.now()}`;
      const next: Phase = {
        kind: "기다림",
        cast: planCast(seed, power, spot, season, rules),
        power,
        seed,
        castAt: performance.now(),
      };
      phaseRef.current = next;
      setPhase(next);
    }
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        press();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        release();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const itemName = (id: string) => defs.items.get(id)?.name ?? id;
  const power =
    phase.kind === "힘" ? castPower(now - phase.heldAt, rules) : undefined;
  const bobber =
    phase.kind === "기다림"
      ? bobberAt(phase.cast, now - phase.castAt, rules)
      : undefined;
  const surge =
    phase.kind === "씨름" ? surgeAt(phase.cast, phase.fight.t, rules) : "없음";
  const distance =
    phase.kind === "씨름"
      ? phase.fight.distance
      : phase.kind === "기다림"
        ? phase.cast.distance
        : undefined;

  const message =
    phase.kind === "준비"
      ? "누르고 있다가 떼면 던져요. 멀리 던질수록 깊은 곳의 큰 고기가 물어요."
      : phase.kind === "힘"
        ? `던질 힘 · ${castZone(power ?? 0, rules)}`
        : phase.kind === "기다림"
          ? bobber === "잠김"
            ? "찌가 잠겼다!"
            : bobber === "톡톡"
              ? "톡톡… 아직이다."
              : "찌를 지켜본다."
          : phase.kind === "씨름"
            ? surge === "차고 나감"
              ? "차고 나간다! 풀어 줘요."
              : surge === "예고"
                ? "물살이 인다!"
                : "누르고 있으면 감고, 떼면 풀어요."
            : phase.reason;

  const surface =
    phase.kind === "준비" || phase.kind === "힘"
      ? "던지기"
      : phase.kind === "기다림"
        ? "채기"
        : phase.kind === "씨름"
          ? "감기"
          : undefined;

  return (
    <main class="stage fs">
      <header class="bar">
        <div class="bar__inner">
          <h1 class="bar__title">낚시 — {spot.name}</h1>
          <div class="bar__side">
            <span class="fs__info">
              {season} · 오늘 {today}번 · 품질{" "}
              {nextSteps === 0 ? "그대로" : `−${nextSteps}단계`}
            </span>
            <button class="bar__button" type="button" onClick={props.onExit}>
              나가기
            </button>
          </div>
        </div>
      </header>

      <section class="fs__scene" aria-label="물가">
        <Scene
          phase={phase}
          bobber={bobber}
          surge={surge}
          distance={distance}
          lineLength={rules.lineLength}
        />
        <p
          class={`fs__message ${bobber === "잠김" || surge !== "없음" ? "fs__message--alert" : ""}`}
          role="status"
          aria-live="assertive"
        >
          {message}
        </p>
        {surface && (
          <button
            class="fs__surface"
            type="button"
            aria-label={surface}
            onPointerDown={(e) => {
              e.preventDefault();
              press();
            }}
            onPointerUp={release}
            onPointerLeave={() => holding.current && release()}
            onPointerCancel={release}
            onContextMenu={(e) => e.preventDefault()}
          />
        )}
      </section>

      <div class="fs__gauges">
        {power !== undefined && <Meter label="던질 힘" value={power} />}
        {phase.kind === "씨름" && (
          <>
            <Meter
              label="줄 팽팽함"
              value={phase.fight.tension}
              danger={phase.fight.tension > 0.7}
            />
            <Meter
              label="남은 거리"
              value={phase.fight.distance / rules.lineLength}
              text={`${phase.fight.distance.toFixed(1)}m`}
            />
          </>
        )}
      </div>

      {phase.kind === "결과" && (
        <section class="paper fs__result" aria-label="낚시 결과">
          {phase.outcome.kind === "낚음" ? (
            phase.revealed &&
            phase.saved?.status === "ok" &&
            phase.saved.caught ? (
              <>
                <h2 class="fs__catch">{itemName(phase.saved.caught.item)}</h2>
                <p>
                  {phase.saved.caught.size}cm · 품질{" "}
                  {phase.saved.caught.quality}
                  {phase.saved.caught.record ? " · 내 최고 기록!" : ""}
                </p>
                {phase.saved.mailed.length > 0 && (
                  <p>가방이 넘쳐 우편함으로 보냈어요.</p>
                )}
              </>
            ) : (
              <h2 class="fs__catch fs__catch--shadow">물 밖으로 무언가가…</h2>
            )
          ) : (
            <h2 class="fs__catch">놓쳤다</h2>
          )}
          {phase.outcome.kind !== "낚음" && (
            <p class="fs__reason">{phase.reason}</p>
          )}
          {phase.saved && phase.saved.status !== "ok" && (
            <p class="fs__problem">
              기록하지 못했어요. 잠시 뒤 다시 해 주세요.
            </p>
          )}
          <div class="fs__buttons">
            <button
              class="button button--main"
              type="button"
              disabled={!phase.saved}
              onClick={() => setPhase({ kind: "준비" })}
            >
              다시 던지기
            </button>
            <button class="button" type="button" onClick={props.onExit}>
              돌아가기
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function Meter(props: {
  label: string;
  value: number;
  text?: string;
  danger?: boolean;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, props.value)) * 100);
  return (
    <div
      class={`fs__meter ${props.danger ? "fs__meter--danger" : ""}`}
      role="meter"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span class="fs__meter-label">
        {props.label} {props.text ?? `${pct}%`}
      </span>
      <span class="fs__meter-bar">
        <span class="fs__meter-fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** 늪가 그림: 물·갈대·안개, 낚싯줄과 찌, 씨름 중에는 고기 그림자와 물살 */
function Scene(props: {
  phase: Phase;
  bobber: string | undefined;
  surge: string;
  distance: number | undefined;
  lineLength: number;
}) {
  const { phase, distance } = props;
  const far = distance === undefined ? 0 : distance / props.lineLength;
  const bx =
    400 +
    (phase.kind === "씨름"
      ? Math.sin(phase.fight.t / 380) * (props.surge === "차고 나감" ? 70 : 25)
      : 0);
  const by = 380 - 40 - far * 230;
  const showLine = phase.kind === "기다림" || phase.kind === "씨름";
  return (
    <svg
      class="fs__svg"
      viewBox="0 0 800 400"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="fs-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3b4a4f" />
          <stop offset="1" stop-color="#1c2427" />
        </linearGradient>
        <linearGradient id="fs-mist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#c9cfc8" stop-opacity="0.55" />
          <stop offset="1" stop-color="#c9cfc8" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="400" fill="#2a3134" />
      <rect y="90" width="800" height="310" fill="url(#fs-water)" />
      <rect y="70" width="800" height="90" fill="url(#fs-mist)" />
      {[60, 110, 690, 740, 770].map((x, i) => (
        <path
          key={x}
          class="fs__reed"
          d={`M${x} 400 Q${x + (i % 2 ? 8 : -8)} 260 ${x + (i % 2 ? 14 : -10)} ${170 + i * 12}`}
        />
      ))}
      {showLine && (
        <path
          class="fs__line"
          d={`M400 400 Q${(400 + bx) / 2} ${by + 60} ${bx} ${by}`}
        />
      )}
      {phase.kind === "씨름" && (
        <>
          <ellipse
            class={`fs__shadow ${props.surge === "차고 나감" ? "fs__shadow--surge" : ""}`}
            cx={bx}
            cy={by + 18}
            rx={26 + 30 * phase.cast.fish.pull}
            ry="9"
          />
          {props.surge !== "없음" && (
            <circle class="fs__ripple" cx={bx} cy={by + 10} r="34" />
          )}
        </>
      )}
      {phase.kind === "기다림" && props.bobber !== "떠남" && (
        <g
          class={`fs__bobber fs__bobber--${props.bobber === "잠김" ? "sink" : props.bobber === "톡톡" ? "nibble" : "calm"}`}
        >
          <circle cx={bx} cy={by} r="7" fill="#c2412d" />
          <rect x={bx - 2} y={by - 16} width="4" height="12" fill="#e9e1cc" />
        </g>
      )}
      {phase.kind === "결과" && phase.outcome.kind === "낚음" && (
        <ellipse
          class={`fs__caught ${phase.revealed ? "fs__caught--shown" : ""}`}
          cx="400"
          cy="200"
          rx={40 + 50 * phase.cast.fish.pull}
          ry="16"
        />
      )}
    </svg>
  );
}
