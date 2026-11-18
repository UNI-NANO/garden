import {
  limitToLast,
  onValue,
  orderByChild,
  push,
  query,
  ref,
} from "firebase/database";
import { useEffect, useMemo, useState } from "preact/hooks";
import rawArena from "../../../data/defs/arena.json";
import { commitDuel, registerBuild } from "../../data/arena";
import type { Firebase } from "../../data/firebase-app";
import { firebasePort } from "../../data/firebase-port";
import { paths } from "../../data/paths";
import { reportError, type Session } from "../../data/session";
import { TRAINING_FATIGUE } from "../../data/training";
import {
  duelBattle,
  seasonKey,
  seasonLabel,
  shadowEnemy,
} from "../../rules/arena";
import type { BattleSetup, BattleState } from "../../rules/battle/engine";
import {
  ArenaEntrySchema,
  ArenaLogLineSchema,
  type ArenaEntry,
  type ArenaLogLine,
} from "../../schema/arena";
import { ArenaDefsSchema, type ArenaDefs } from "../../schema/defs/arena";
import type { Limits } from "../../schema/defs/limits";
import { BattleScreen } from "../battle/BattleScreen";
import { loadBattleDefs, type BattleDefs } from "../battle/defs";
import "../battle/battle.css";
import { Notice, Paper } from "../parts";
import "./arena.css";

type SignedIn = Extract<Session, { status: "signedIn" }>;

/**
 * 투기장 (docs/ui/Arena, 8단계 ④ 나). 계절 순위표, 내 빌드 등록, 상대 고르기 → 그 빌드의 그림자와 결투.
 * 결투마다 훈련장 분야 피로 +1. 도전한 사람 점수만 바뀐다.
 */
export function ArenaScreen(props: {
  fb: Firebase;
  limits: Limits;
  session: SignedIn;
  onExit: () => void;
}) {
  const defs = useMemo<{ arena: ArenaDefs; battle: BattleDefs } | Error>(() => {
    try {
      return {
        arena: ArenaDefsSchema.parse(rawArena),
        battle: loadBattleDefs(),
      };
    } catch (error) {
      reportError(props.fb, error, "투기장 정의 읽기");
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [props.fb]);
  const { character, characterId } = props.session;
  if (defs instanceof Error)
    return (
      <Notice title="투기장">
        투기장 기록을 읽지 못했어요. 기록해 두었어요.
      </Notice>
    );
  if (!character || !characterId)
    return <Notice title="투기장">열람증이 준비되면 들어갈 수 있어요.</Notice>;
  return (
    <Arena
      {...props}
      defs={defs}
      characterId={characterId}
      character={character}
    />
  );
}

type Row = ArenaEntry & { cid: string };

function Arena(props: {
  fb: Firebase;
  limits: Limits;
  onExit: () => void;
  defs: { arena: ArenaDefs; battle: BattleDefs };
  characterId: string;
  character: NonNullable<SignedIn["character"]>;
}) {
  const { fb, limits, defs, character, characterId } = props;
  const arena = defs.arena.arenas[0]!;
  const season = seasonKey(character.month.key);
  const trees = [defs.battle.practice.tree];
  const allyDefs = { ...defs.battle.practice, trees, arena: defs.arena };
  const [rows, setRows] = useState<Row[]>();
  const [log, setLog] = useState<(ArenaLogLine & { id: string })[]>([]);
  const [picked, setPicked] = useState<string>();
  const [fight, setFight] = useState<{ setup: BattleSetup; opponent: Row }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const fatigue = character.month.fatigue[TRAINING_FATIGUE] ?? 0;
  const newRequestId = () =>
    push(ref(fb.db, "requests")).key ?? `arena${Date.now()}`;

  useEffect(() => {
    const stopEntries = onValue(
      ref(fb.db, paths.arenaEntries(season)),
      (snap) => {
        const list: Row[] = [];
        for (const [cid, raw] of Object.entries(
          (snap.val() ?? {}) as Record<string, unknown>,
        )) {
          const parsed = ArenaEntrySchema.safeParse(raw);
          if (parsed.success) list.push({ ...parsed.data, cid });
          else
            reportError(
              fb,
              new Error(`투기장 칸 모양이 틀리다: ${cid}`),
              "투기장 순위표 읽기",
            );
        }
        setRows(
          list.sort(
            (a, b) =>
              b.score - a.score ||
              b.wins - a.wins ||
              a.build.name.localeCompare(b.build.name, "ko"),
          ),
        );
      },
      (error) => reportError(fb, error, "투기장 순위표 읽기"),
    );
    const stopLog = onValue(
      query(
        ref(fb.db, paths.arenaLogs(season, characterId)),
        orderByChild("at"),
        limitToLast(5),
      ),
      (snap) => {
        const lines = Object.entries(
          (snap.val() ?? {}) as Record<string, unknown>,
        ).flatMap(([id, raw]) => {
          const parsed = ArenaLogLineSchema.safeParse(raw);
          return parsed.success ? [{ ...parsed.data, id }] : [];
        });
        setLog(lines.sort((a, b) => b.at - a.at));
      },
      (error) => reportError(fb, error, "투기장 기록 읽기"),
    );
    return () => {
      stopEntries();
      stopLog();
    };
  }, [fb, season, characterId]);

  const mine = rows?.find((r) => r.cid === characterId);
  const opponent = rows?.find((r) => r.cid === picked && r.cid !== characterId);

  const register = async () => {
    setBusy(true);
    try {
      const result = await registerBuild(
        firebasePort(fb.db),
        characterId,
        newRequestId(),
        trees,
        { limits, now: Date.now() },
      );
      if (result.status === "ok")
        setMessage(
          mine
            ? "빌드를 다시 등록했어요. 점수는 그대로예요."
            : "투기장에 빌드를 등록했어요.",
        );
      else {
        setMessage(
          result.status === "rejected"
            ? `등록하지 못했어요: ${result.detail}`
            : "등록하지 못했어요. 잠시 뒤 다시 해 주세요.",
        );
        if (result.status !== "duplicate")
          reportError(
            fb,
            new Error(`투기장 등록: ${result.status}`),
            "투기장 등록",
          );
      }
    } catch (error) {
      reportError(fb, error, "투기장 등록");
      setMessage("등록하지 못했어요. 잠시 뒤 다시 해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const challenge = (row: Row) => {
    try {
      setMessage(undefined);
      setFight({
        setup: duelBattle(
          character,
          { cid: row.cid, build: row.build },
          allyDefs,
          newRequestId(),
        ),
        opponent: row,
      });
    } catch (error) {
      reportError(fb, error, "결투 열기");
      setMessage("결투를 열지 못했어요.");
    }
  };

  const finish = async (row: Row, battle: BattleState) => {
    setFight(undefined);
    setBusy(true);
    const won = battle.outcome === "승리";
    try {
      const result = await commitDuel(
        firebasePort(fb.db),
        characterId,
        newRequestId(),
        { opponent: row.cid, won },
        { limits, now: Date.now() },
      );
      if (result.status === "ok") {
        const d = result.delta ?? 0;
        setMessage(
          `${row.build.name}의 그림자에게 ${won ? "이겼어요" : "졌어요"} · 점수 ${d >= 0 ? "+" : ""}${d} (${result.entry.score})`,
        );
      } else {
        setMessage(
          result.status === "rejected"
            ? `기록하지 못했어요: ${result.detail}`
            : "기록하지 못했어요. 잠시 뒤 다시 해 주세요.",
        );
        if (result.status !== "duplicate")
          reportError(fb, new Error(`결투: ${result.status}`), "결투 저장");
      }
    } catch (error) {
      reportError(fb, error, "결투 저장");
      setMessage("기록하지 못했어요. 잠시 뒤 다시 해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  if (fight)
    return (
      <BattleScreen
        key={fight.setup.id}
        fb={fb}
        defs={defs.battle}
        setup={fight.setup}
        title={`결투 · ${fight.opponent.build.name}의 그림자`}
        onRetry={() => undefined}
        onExit={() => undefined}
        onFinish={(battle) => void finish(fight.opponent, battle)}
      />
    );

  const actionsOf = (row: Row) => {
    try {
      return shadowEnemy(row.build, "preview", allyDefs).actions.map(
        (a) => a.name,
      );
    } catch {
      return [];
    }
  };

  return (
    <main class="stage ar">
      <header class="bar">
        <div class="bar__inner">
          <h1 class="bar__title">{arena.name}</h1>
          <div class="bar__side">
            <span class="ar__info">
              {seasonLabel(season)} · 오늘 훈련장 {fatigue}번
            </span>
            <button class="bar__button" type="button" onClick={props.onExit}>
              나가기
            </button>
          </div>
        </div>
      </header>

      {message && (
        <p class="ar__message" role="status">
          {message}
        </p>
      )}

      <div class="ar__body">
        <Paper class="ar__board" label="계절 순위표">
          <h2 class="ar__title">계절 순위표 · {seasonLabel(season)}</h2>
          {rows === undefined ? (
            <p>순위표를 펼치는 중…</p>
          ) : rows.length === 0 ? (
            <p>아직 아무도 등록하지 않았어요.</p>
          ) : (
            <table class="ar__table">
              <thead>
                <tr>
                  <th scope="col">순위</th>
                  <th scope="col">이름</th>
                  <th scope="col">점수</th>
                  <th scope="col">기록</th>
                  <th scope="col">
                    <span class="ar__sr">고르기</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.cid}
                    class={
                      r.cid === characterId
                        ? "ar__me"
                        : r.cid === picked
                          ? "ar__picked"
                          : ""
                    }
                  >
                    <td>{i + 1}</td>
                    <td>
                      {r.build.name}
                      {r.cid === characterId ? " (나)" : ""}
                    </td>
                    <td>{r.score.toLocaleString("ko-KR")}</td>
                    <td>
                      {r.wins}승 {r.losses}패
                    </td>
                    <td>
                      {r.cid !== characterId && (
                        <button
                          class="button button--small"
                          type="button"
                          aria-label={`${r.build.name} 고르기`}
                          onClick={() => setPicked(r.cid)}
                        >
                          고르기
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Paper>

        <div class="ar__side">
          <Paper class="ar__card" label="결투 신청">
            <h2 class="ar__title">결투 신청</h2>
            {!mine ? (
              <p>먼저 내 빌드를 등록해야 결투할 수 있어요.</p>
            ) : opponent ? (
              <>
                <p>
                  <b>{opponent.build.name}</b>에게 · 점수{" "}
                  {opponent.score.toLocaleString("ko-KR")}
                </p>
                <p class="ar__note">
                  상대가 접속해 있지 않아도, 등록한 빌드의 그림자와 싸워요.
                </p>
                <dl class="ar__facts">
                  <dt>상대 빌드</dt>
                  <dd>
                    {defs.battle.practice.tree.id === opponent.build.treeId
                      ? defs.battle.practice.tree.name
                      : opponent.build.treeId}{" "}
                    {opponent.build.mastery.toFixed(2)}
                  </dd>
                  <dt>쓰는 기술</dt>
                  <dd>{actionsOf(opponent).join(" · ")}</dd>
                  <dt>걸 것</dt>
                  <dd>점수만 · 부상 없음</dd>
                </dl>
                <button
                  class="button button--main"
                  type="button"
                  disabled={busy}
                  onClick={() => challenge(opponent)}
                >
                  결투 신청
                </button>
              </>
            ) : (
              <p>순위표에서 상대를 골라 주세요.</p>
            )}
            <p class="ar__note">
              결투할 때마다 오늘 훈련장 피로가 하나 올라요. 많이 할수록 이겨서
              얻는 점수가 줄어요.
            </p>
          </Paper>

          <Paper class="ar__card" label="내 빌드">
            <h2 class="ar__title">내 빌드</h2>
            {mine ? (
              <p>
                등록됨 · {mine.score.toLocaleString("ko-KR")}점 · {mine.wins}승{" "}
                {mine.losses}패
              </p>
            ) : (
              <p>아직 등록하지 않았어요.</p>
            )}
            <p class="ar__note">
              다른 사람은 등록할 때의 장착·숙련으로 만든 그림자와 싸워요. 빌드를
              바꿨으면 다시 등록해 주세요.
            </p>
            <button
              class="button"
              type="button"
              disabled={busy}
              onClick={() => void register()}
            >
              {mine ? "다시 등록" : "빌드 등록"}
            </button>
          </Paper>

          <Paper class="ar__card" label="나에게 온 도전">
            <h2 class="ar__title">나에게 온 도전</h2>
            {log.length === 0 ? (
              <p class="ar__note">아직 없어요.</p>
            ) : (
              <ul class="ar__log">
                {log.map((l) => (
                  <li key={l.id}>
                    {l.fromName} —{" "}
                    {l.challengerWon
                      ? "내 그림자가 졌어요"
                      : "내 그림자가 이겼어요"}
                  </li>
                ))}
              </ul>
            )}
          </Paper>
        </div>
      </div>
    </main>
  );
}
