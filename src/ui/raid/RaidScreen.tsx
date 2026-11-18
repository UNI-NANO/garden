import { onValue, push, ref } from "firebase/database";
import { useEffect, useMemo, useState } from "preact/hooks";
import rawItems from "../../../data/defs/items.json";
import rawRaids from "../../../data/defs/raids.json";
import type { Firebase } from "../../data/firebase-app";
import { firebasePort } from "../../data/firebase-port";
import { paths } from "../../data/paths";
import { commitRaid, RAID_FATIGUE, raidRewardId } from "../../data/raid";
import { reportError, type Session } from "../../data/session";
import type { BattleSetup, BattleState } from "../../rules/battle/engine";
import type { Gain } from "../../rules/dungeon/explore";
import {
  contribution,
  gradeOf,
  raidBattle,
  raidWeek,
  type Contribution,
} from "../../rules/raid";
import { ItemListSchema, type Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import { RaidDefsSchema, type RaidDefs } from "../../schema/defs/raid";
import { idToKey } from "../../schema/keys";
import { RaidRecordSchema, type RaidRecord } from "../../schema/raid";
import { BattleScreen } from "../battle/BattleScreen";
import { loadBattleDefs, type BattleDefs } from "../battle/defs";
import "../battle/battle.css";
import { withJosa } from "../josa";
import { Notice, Paper } from "../parts";
import "./raid.css";

type SignedIn = Extract<Session, { status: "signedIn" }>;

/**
 * 반복 레이드 (docs/ui/Raid, 8단계 ⑤). 이번 주 보스에게 혼자 도전한다(파티는 동료·파티 단계에서).
 * 그 주 처음 이기면 주간 보상, 그다음은 피로를 적용한 일반 보상. 판마다 기여 점수를 매겨 최고 기록만 남긴다.
 */
export function RaidScreen(props: {
  fb: Firebase;
  limits: Limits;
  session: SignedIn;
  onExit: () => void;
}) {
  const defs = useMemo<
    | { raids: RaidDefs; items: ReadonlyMap<string, Item>; battle: BattleDefs }
    | Error
  >(() => {
    try {
      return {
        raids: RaidDefsSchema.parse(rawRaids),
        items: new Map(
          ItemListSchema.parse(rawItems).items.map((i) => [i.id, i]),
        ),
        battle: loadBattleDefs(),
      };
    } catch (error) {
      reportError(props.fb, error, "레이드 정의 읽기");
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [props.fb]);
  const { character, characterId } = props.session;
  if (defs instanceof Error)
    return (
      <Notice title="반복 레이드">
        레이드 기록을 읽지 못했어요. 기록해 두었어요.
      </Notice>
    );
  if (!character || !characterId)
    return (
      <Notice title="반복 레이드">열람증이 준비되면 도전할 수 있어요.</Notice>
    );
  return (
    <Raid
      {...props}
      defs={defs}
      characterId={characterId}
      character={character}
    />
  );
}

type Result =
  | {
      won: boolean;
      contribution: Contribution;
      weekly: boolean;
      gains: Gain[];
      record: boolean;
    }
  | { problem: string };

function Raid(props: {
  fb: Firebase;
  limits: Limits;
  onExit: () => void;
  defs: {
    raids: RaidDefs;
    items: ReadonlyMap<string, Item>;
    battle: BattleDefs;
  };
  characterId: string;
  character: NonNullable<SignedIn["character"]>;
}) {
  const { fb, limits, defs, character, characterId } = props;
  const week = raidWeek(Date.now(), defs.raids, limits);
  const { boss } = week;
  const [records, setRecords] = useState<(RaidRecord & { cid: string })[]>([]);
  const [fight, setFight] = useState<BattleSetup>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const fatigue = character.month.fatigue[RAID_FATIGUE] ?? 0;
  const claimed =
    character.claimedRewards[idToKey(raidRewardId(week.key))] === true;
  const newRequestId = () =>
    push(ref(fb.db, "requests")).key ?? `raid${Date.now()}`;
  const itemName = (id: string) => defs.items.get(id)?.name ?? id;
  const gainText = (g: Gain) =>
    g.kind === "잎전"
      ? `${g.quantity} 잎전`
      : `${itemName(g.item)} ×${g.kind === "묶음" ? g.quantity : 1}`;

  useEffect(
    () =>
      onValue(
        ref(fb.db, paths.raidRecords(week.key)),
        (snap) => {
          const list = Object.entries(
            (snap.val() ?? {}) as Record<string, unknown>,
          ).flatMap(([cid, raw]) => {
            const parsed = RaidRecordSchema.safeParse(raw);
            return parsed.success ? [{ ...parsed.data, cid }] : [];
          });
          setRecords(list.sort((a, b) => b.score - a.score));
        },
        (error) => reportError(fb, error, "레이드 기여 기록 읽기"),
      ),
    [fb, week.key],
  );

  const mine = records.find((r) => r.cid === characterId);
  const left = Math.max(0, week.nextChangeAt - Date.now());
  const leftText = `${Math.floor(left / 86400000)}일 ${Math.floor((left % 86400000) / 3600000)}시간`;

  const challenge = () => {
    try {
      setResult(undefined);
      setFight(
        raidBattle(
          character,
          boss,
          { ...defs.battle.practice, trees: [defs.battle.practice.tree] },
          newRequestId(),
        ),
      );
    } catch (error) {
      reportError(fb, error, "레이드 전투 열기");
      setResult({ problem: "싸움을 열지 못했어요." });
    }
  };

  const finish = async (battle: BattleState) => {
    setFight(undefined);
    setBusy(true);
    const won = battle.outcome === "승리";
    const player = battle.allies.find((a) => a.kind === "플레이어");
    const c = contribution(
      battle.events,
      player?.id ?? "player",
      new Set(battle.enemies.map((e) => e.id)),
      defs.raids.contribution,
    );
    try {
      const saved = await commitRaid(
        firebasePort(fb.db),
        characterId,
        newRequestId(),
        { weekKey: week.key, bossId: boss.id, won, contribution: c },
        defs.raids,
        { limits, items: defs.items, now: Date.now(), carryLimit: 100 },
      );
      if (saved.status === "ok")
        setResult({
          won,
          contribution: c,
          weekly: saved.weekly,
          gains: saved.gains,
          record: saved.record,
        });
      else {
        setResult({
          problem:
            saved.status === "rejected"
              ? `기록하지 못했어요: ${saved.detail}`
              : "기록하지 못했어요. 잠시 뒤 다시 해 주세요.",
        });
        if (saved.status !== "duplicate")
          reportError(fb, new Error(`레이드: ${saved.status}`), "레이드 저장");
      }
    } catch (error) {
      reportError(fb, error, "레이드 저장");
      setResult({ problem: "기록하지 못했어요. 잠시 뒤 다시 해 주세요." });
    } finally {
      setBusy(false);
    }
  };

  if (fight)
    return (
      <BattleScreen
        key={fight.id}
        fb={fb}
        defs={defs.battle}
        setup={fight}
        title={`반복 레이드 · ${boss.name}`}
        onRetry={() => undefined}
        onExit={() => undefined}
        onFinish={(battle) => void finish(battle)}
      />
    );

  return (
    <main class="stage rd">
      <header class="bar">
        <div class="bar__inner">
          <h1 class="bar__title">반복 레이드</h1>
          <div class="bar__side">
            <span class="rd__info">오늘 레이드 {fatigue}번</span>
            <button class="bar__button" type="button" onClick={props.onExit}>
              나가기
            </button>
          </div>
        </div>
      </header>

      <div class="rd__body">
        <div class="rd__main">
          <Paper class="rd__card" label="이번 주 보스">
            <p class="rd__kicker">이번 주 보스 · 다음 교대까지 {leftText}</p>
            <h2 class="rd__boss">{boss.name}</h2>
            <p class="rd__note">{boss.region}</p>
            <dl class="rd__facts">
              <dt>주간 보상</dt>
              <dd>
                {claimed
                  ? "이번 주에 받았어요"
                  : boss.weekly
                      .map((r) =>
                        r.kind === "잎전"
                          ? `${r.quantity} 잎전`
                          : `${itemName(r.item)} ×${r.quantity}`,
                      )
                      .join(" · ")}
              </dd>
              <dt>그다음</dt>
              <dd>
                {boss.repeat
                  .map((r) =>
                    r.kind === "잎전"
                      ? `${r.quantity} 잎전`
                      : `${itemName(r.item)} ×${r.quantity}`,
                  )
                  .join(" · ")}{" "}
                (피로에 따라 줄어요)
              </dd>
              <dt>내 최고 기여</dt>
              <dd>
                {mine
                  ? `${mine.score}점 · ${gradeOf(mine.score, defs.raids.contribution.grades)}`
                  : "아직 없음"}
              </dd>
            </dl>
            <p class="rd__note">
              지금은 혼자 도전해요. 도망칠 수 없고, 도전할 때마다 오늘 레이드
              피로가 하나 올라요.
            </p>
            <button
              class="button button--main"
              type="button"
              disabled={busy}
              onClick={challenge}
            >
              도전
            </button>
          </Paper>

          {result && (
            <Paper class="rd__card" label="레이드 결과">
              {"problem" in result ? (
                <p role="status">{result.problem}</p>
              ) : (
                <div role="status">
                  <h2 class="rd__title">
                    {result.won
                      ? `${withJosa(boss.name, "을", "를")} 쓰러뜨렸어요`
                      : `${boss.name}에게 밀려났어요`}
                  </h2>
                  {result.won && (
                    <p>
                      {result.weekly ? "주간 보상" : "보상"}:{" "}
                      {result.gains.map(gainText).join(" · ")}
                    </p>
                  )}
                  <p>
                    이번 판 기여 {result.contribution.score}점 ·{" "}
                    {gradeOf(
                      result.contribution.score,
                      defs.raids.contribution.grades,
                    )}
                    {result.record ? " · 이번 주 최고 기록!" : ""}
                  </p>
                  <p class="rd__note">
                    준 피해 {result.contribution.damage} · 흐트러짐{" "}
                    {result.contribution.stagger} · 막아준 피해{" "}
                    {result.contribution.prevented} · 받아치기·피하기{" "}
                    {result.contribution.reactions}번
                  </p>
                </div>
              )}
            </Paper>
          )}
        </div>

        <Paper class="rd__card" label="이번 주 기여">
          <h2 class="rd__title">이번 주 기여</h2>
          {records.length === 0 ? (
            <p class="rd__note">아직 아무도 도전하지 않았어요.</p>
          ) : (
            <ol class="rd__ranks">
              {records.slice(0, 10).map((r) => (
                <li key={r.cid} class={r.cid === characterId ? "rd__me" : ""}>
                  {r.name} — {r.score}점 ·{" "}
                  {gradeOf(r.score, defs.raids.contribution.grades)}
                </li>
              ))}
            </ol>
          )}
          <p class="rd__note">한 판의 최고 점수만 남아요(더하지 않아요).</p>
        </Paper>
      </div>
    </main>
  );
}
