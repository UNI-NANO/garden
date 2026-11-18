import { push, ref } from "firebase/database";
import { useMemo, useState } from "preact/hooks";
import rawItems from "../../../data/defs/items.json";
import rawTraining from "../../../data/defs/training.json";
import type { Firebase } from "../../data/firebase-app";
import { firebasePort } from "../../data/firebase-port";
import { reportError, type Session } from "../../data/session";
import { commitWallTest, TRAINING_FATIGUE } from "../../data/training";
import type { BattleSetup, BattleState } from "../../rules/battle/engine";
import {
  blockedWalls,
  dummyBattle,
  wallBattle,
  wallStatus,
  type BlockedWall,
} from "../../rules/training";
import { ItemListSchema } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import {
  TrainingDefsSchema,
  type TrainingDefs,
} from "../../schema/defs/training";
import { hidePowerFor } from "../../rules/codex";
import { BattleScreen } from "../battle/BattleScreen";
import { loadBattleDefs, type BattleDefs } from "../battle/defs";
import "../battle/battle.css";
import { Notice, Paper } from "../parts";
import "./training.css";

type SignedIn = Extract<Session, { status: "signedIn" }>;
const GROUND_ID = "reinfeld-yard";
const ITEMS = new Map(ItemListSchema.parse(rawItems).items.map((i) => [i.id, i]));

/**
 * 훈련장 (docs/ui/Training, 8단계 ④ 가). 허수아비 치기(보상·피로 없음, 저장 안 함)와
 * 교관 대련(숙련도 벽에 막혔을 때만, 이기면 통과, 도전마다 훈련장 피로 +1).
 */
export function TrainingScreen(props: {
  fb: Firebase;
  limits: Limits;
  session: SignedIn;
  onExit: () => void;
}) {
  const defs = useMemo<
    { training: TrainingDefs; battle: BattleDefs } | Error
  >(() => {
    try {
      return {
        training: TrainingDefsSchema.parse(rawTraining),
        battle: loadBattleDefs(),
      };
    } catch (error) {
      reportError(props.fb, error, "훈련장 정의 읽기");
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [props.fb]);
  const { character, characterId } = props.session;
  if (defs instanceof Error)
    return (
      <Notice title="훈련장">
        훈련장 기록을 읽지 못했어요. 기록해 두었어요.
      </Notice>
    );
  if (!character || !characterId)
    return <Notice title="훈련장">열람증이 준비되면 들어갈 수 있어요.</Notice>;
  const ground = defs.training.grounds.find((g) => g.id === GROUND_ID);
  if (!ground) return <Notice title="훈련장">훈련장을 찾지 못했어요.</Notice>;
  return (
    <Training
      {...props}
      defs={defs}
      ground={ground}
      characterId={characterId}
      character={character}
    />
  );
}

type Fight =
  | { kind: "허수아비"; setup: BattleSetup; round: number }
  | { kind: "대련"; setup: BattleSetup; blocked: BlockedWall };

function Training(props: {
  fb: Firebase;
  limits: Limits;
  onExit: () => void;
  defs: { training: TrainingDefs; battle: BattleDefs };
  ground: TrainingDefs["grounds"][number];
  characterId: string;
  character: NonNullable<SignedIn["character"]>;
}) {
  const { fb, limits, defs, ground, character, characterId } = props;
  const trees = [defs.battle.practice.tree];
  const allyDefs = { ...defs.battle.practice, trees };
  const [fight, setFight] = useState<Fight>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { blocked: BlockedWall; won: boolean } | { problem: string }
  >();
  const blocked = blockedWalls(character, ground, trees);
  const fatigue = character.month.fatigue[TRAINING_FATIGUE] ?? 0;
  const newSeed = () =>
    push(ref(fb.db, "requests")).key ?? `train${Date.now()}`;

  const open = (make: () => Fight) => {
    try {
      setResult(undefined);
      setFight(make());
    } catch (error) {
      reportError(fb, error, "훈련장 전투 열기");
      setResult({ problem: "싸움을 열지 못했어요." });
    }
  };
  const hitDummy = (round = 0) =>
    open(() => ({
      kind: "허수아비",
      setup: dummyBattle(character, ground, allyDefs, newSeed()),
      round,
    }));
  const challenge = (b: BlockedWall) =>
    open(() => ({
      kind: "대련",
      setup: wallBattle(character, b, allyDefs, newSeed()),
      blocked: b,
    }));

  const finish = async (b: BlockedWall, battle: BattleState) => {
    setFight(undefined);
    setBusy(true);
    const won = battle.outcome === "승리";
    try {
      const saved = await commitWallTest(
        firebasePort(fb.db),
        characterId,
        newSeed(),
        {
          groundId: ground.id,
          skill: b.skill,
          skillName: b.skillName,
          wall: b.wall.at,
          won,
        },
        defs.training,
        { limits, items: ITEMS, now: Date.now(), carryLimit: 100 },
      );
      if (saved.status === "ok") setResult({ blocked: b, won });
      else {
        setResult({
          problem:
            saved.status === "rejected"
              ? `기록하지 못했어요: ${saved.detail}`
              : "기록하지 못했어요. 잠시 뒤 다시 해 주세요.",
        });
        if (saved.status !== "duplicate")
          reportError(
            fb,
            new Error(`훈련장: ${saved.status}`),
            "교관 대련 저장",
          );
      }
    } catch (error) {
      reportError(fb, error, "교관 대련 저장");
      setResult({ problem: "기록하지 못했어요. 잠시 뒤 다시 해 주세요." });
    } finally {
      setBusy(false);
    }
  };

  if (fight?.kind === "허수아비")
    return (
      <BattleScreen
        key={`${fight.setup.id}-${fight.round}`}
        fb={fb}
        defs={defs.battle}
        setup={fight.setup}
        title={`훈련장 · 허수아비`}
        onRetry={() => hitDummy(fight.round + 1)}
        onExit={() => setFight(undefined)}
      />
    );
  if (fight?.kind === "대련")
    return (
      <BattleScreen
        key={fight.setup.id}
        fb={fb}
        defs={defs.battle}
        setup={fight.setup}
        title={`교관 대련 · ${fight.blocked.wall.instructor}`}
        onRetry={() => undefined}
        onExit={() => undefined}
        hidePower={hidePowerFor(character, defs.battle.practice.enemies, limits)}
        onFinish={(battle) => void finish(fight.blocked, battle)}
      />
    );

  return (
    <main class="stage tr">
      <header class="bar">
        <div class="bar__inner">
          <h1 class="bar__title">{ground.name}</h1>
          <div class="bar__side">
            <span class="tr__info">
              {ground.region} · 오늘 훈련장 {fatigue}번
            </span>
            <button class="bar__button" type="button" onClick={props.onExit}>
              나가기
            </button>
          </div>
        </div>
      </header>

      {result && (
        <p class="tr__message" role="status">
          {"problem" in result
            ? result.problem
            : result.won
              ? `${result.blocked.skillName} ${result.blocked.wall.at} 벽을 넘었어요. 이제 숙련도가 다시 오를 수 있어요.`
              : `${result.blocked.wall.instructor}: 「${result.blocked.wall.line}」 — 언제든 다시 도전할 수 있어요.`}
        </p>
      )}

      <div class="tr__body">
        <Paper class="tr__card" label="허수아비">
          <h2 class="tr__title">허수아비</h2>
          <p class="tr__note">
            판정 바 연습 · 보상 없음 · 피로 없음. 맞아도 다치지 않아요.
          </p>
          <button
            class="button button--main"
            type="button"
            disabled={busy}
            onClick={() => hitDummy()}
          >
            치기
          </button>
        </Paper>

        <Paper class="tr__card" label="교관 대련">
          <h2 class="tr__title">교관 대련</h2>
          {blocked.length > 0 ? (
            <ul class="tr__list">
              {blocked.map((b) => (
                <li key={`${b.skill}-${b.wall.at}`} class="tr__wall">
                  <div>
                    <b>
                      {b.skillName} {b.wall.at} 벽 시험
                    </b>
                    <span class="tr__note">
                      {" "}
                      · {b.wall.instructor} · 이기면 벽 통과
                    </span>
                  </div>
                  <button
                    class="button button--main"
                    type="button"
                    disabled={busy}
                    onClick={() => challenge(b)}
                  >
                    도전
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p>지금 넘을 벽이 없어요.</p>
              <ul class="tr__list">
                {wallStatus(character, trees).map((s) => (
                  <li key={s.skill} class="tr__status">
                    {s.skillName} {s.value.toFixed(2)} · 60 벽{" "}
                    {s.passed60 ? "통과" : "아직"} · 80 벽{" "}
                    {s.passed80 ? "통과" : "아직"}
                  </li>
                ))}
              </ul>
              <p class="tr__note">
                숙련도가 59.99·79.99에서 멈추면 교관에게 도전할 수 있어요.
              </p>
            </>
          )}
          <p class="tr__note">도전할 때마다 오늘 훈련장 피로가 하나 올라요.</p>
        </Paper>
      </div>
    </main>
  );
}
