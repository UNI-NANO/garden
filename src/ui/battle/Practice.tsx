import { useMemo, useState } from "preact/hooks";
import type { Firebase } from "../../data/firebase-app";
import { reportError } from "../../data/session";
import type { BattleSetup } from "../../rules/battle/engine";
import { buildPractice, practiceRoutes, PRACTICE_FOES, PRACTICE_PARTIES, PRACTICE_PLAYER, type PracticeChoice } from "../../rules/battle/practice";
import { Notice, Paper } from "../parts";
import { BattleScreen } from "./BattleScreen";
import "./battle.css";
import { loadBattleDefs, type BattleDefs } from "./defs";

/** 연습 전투 (시험 환경에만): 편성을 고르고 → 싸우고 → 결과 */
export function Practice(props: { fb: Firebase; onExit: () => void }) {
  const loaded = useMemo((): { defs: BattleDefs } | { error: unknown } => {
    try {
      return { defs: loadBattleDefs() };
    } catch (error) {
      return { error };
    }
  }, []);
  const [running, setRunning] = useState<{ setup: BattleSetup; choice: PracticeChoice; round: number }>();

  if ("error" in loaded) {
    reportError(props.fb, loaded.error, "연습 전투 준비");
    return <Notice title="연습장을 열지 못했어요">정의 데이터를 읽지 못했어요. 기록해 두었으니 GM에게 알려 주세요.</Notice>;
  }
  const { defs } = loaded;
  const start = (choice: PracticeChoice, round: number) => {
    try {
      setRunning({ setup: buildPractice(defs.practice, choice), choice, round });
    } catch (error) {
      reportError(props.fb, error, "연습 전투 편성");
    }
  };

  if (running) {
    return (
      <BattleScreen
        key={running.round}
        fb={props.fb}
        defs={defs}
        setup={running.setup}
        title={`연습 전투 — ${running.choice.foes}`}
        onRetry={() => start({ ...running.choice, seed: `연습-${running.round + 1}` }, running.round + 1)}
        onExit={() => setRunning(undefined)}
      />
    );
  }
  return <PracticeSetup defs={defs} onStart={(choice) => start(choice, 1)} onExit={props.onExit} />;
}

const NO_ROUTE = "";

function PracticeSetup(props: { defs: BattleDefs; onStart: (choice: PracticeChoice) => void; onExit: () => void }) {
  const { tree, skillTable } = props.defs.practice;
  const basics = tree.nodes.filter((n) => n.kind === "기본기");
  const [chosen, setChosen] = useState<string[]>(basics.slice(0, skillTable.tree.equippedBasics).map((b) => b.id));
  const [routes, setRoutes] = useState<Record<string, string>>({});
  const [ultimate, setUltimate] = useState(NO_ROUTE);
  const [foes, setFoes] = useState<PracticeChoice["foes"]>("늑대 하나");
  const [party, setParty] = useState<PracticeChoice["party"]>("혼자");

  const need = skillTable.tree.equippedBasics;
  const toggle = (id: string) => setChosen(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const ultimateChoices = chosen.flatMap((id) => {
    const route = routes[id];
    return route ? practiceRoutes(tree, id).filter((r) => r.endId === route) : [];
  });
  const ultimateOk = ultimate === NO_ROUTE || ultimateChoices.some((r) => r.endId === ultimate);

  const submit = () => {
    const choice: PracticeChoice = {
      basics: chosen.map((id) => (routes[id] ? { id, route: routes[id] } : { id })),
      foes,
      party,
      seed: "연습-1",
      ...(ultimate !== NO_ROUTE && ultimateOk ? { ultimateRoute: ultimate } : {}),
    };
    props.onStart(choice);
  };

  return (
    <main class="stage practice">
      <Paper class="practice__paper" label="연습 전투 편성">
        <h1 class="paper__heading">연습 전투</h1>
        <p class="practice__note">
          시험 환경에만 있는 연습장이에요. 저장하지 않고 보상도 없어요. 검술 숙련도 {PRACTICE_PLAYER.mastery} · 건강 {PRACTICE_PLAYER.health}로 싸웁니다.
        </p>

        <fieldset class="practice__group">
          <legend>
            기본기 {need}개 ({chosen.length}/{need})
          </legend>
          {basics.map((basic) => (
            <div key={basic.id} class="practice__row">
              <label class="practice__check">
                <input type="checkbox" checked={chosen.includes(basic.id)} onChange={() => toggle(basic.id)} />
                {basic.name}
              </label>
              <select
                aria-label={`${basic.name} 루트`}
                disabled={!chosen.includes(basic.id)}
                value={routes[basic.id] ?? NO_ROUTE}
                onChange={(e) => setRoutes({ ...routes, [basic.id]: (e.currentTarget as HTMLSelectElement).value })}
              >
                <option value={NO_ROUTE}>기본 모양</option>
                {practiceRoutes(tree, basic.id).map((r) => (
                  <option key={r.endId} value={r.endId}>
                    {r.name}까지
                  </option>
                ))}
              </select>
            </div>
          ))}
        </fieldset>

        <fieldset class="practice__group">
          <legend>궁극기</legend>
          <select aria-label="궁극기" value={ultimateOk ? ultimate : NO_ROUTE} onChange={(e) => setUltimate((e.currentTarget as HTMLSelectElement).value)}>
            <option value={NO_ROUTE}>들지 않음</option>
            {ultimateChoices.map((r) => (
              <option key={r.endId} value={r.endId}>
                {r.ultimateName}
              </option>
            ))}
          </select>
          <p class="practice__hint">루트를 끝갈래까지 고른 기본기의 궁극기만 들 수 있어요.</p>
        </fieldset>

        <fieldset class="practice__group">
          <legend>상대</legend>
          {PRACTICE_FOES.map((f) => (
            <label key={f} class="practice__radio">
              <input type="radio" name="foes" checked={foes === f} onChange={() => setFoes(f)} />
              {f}
            </label>
          ))}
        </fieldset>

        <fieldset class="practice__group">
          <legend>편성</legend>
          {PRACTICE_PARTIES.map((p) => (
            <label key={p} class="practice__radio">
              <input type="radio" name="party" checked={party === p} onChange={() => setParty(p)} />
              {p}
            </label>
          ))}
        </fieldset>

        <div class="practice__buttons">
          <button class="button button--main" type="button" disabled={chosen.length !== need} onClick={submit}>
            싸우기
          </button>
          <button class="button" type="button" onClick={props.onExit}>
            돌아가기
          </button>
        </div>
      </Paper>
    </main>
  );
}
