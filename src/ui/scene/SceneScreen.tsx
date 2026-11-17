import { useEffect, useState } from "preact/hooks";
import type { BattleOutcome, Scene } from "../../rules/scene/parse";
import { advance, battleOutcome, choose, startScene, type Cursor, type Frame, type SceneContext, type Segment } from "../../rules/scene/run";

/** 장면이 끝났을 때 결과를 저장한 뒤의 상태 */
export type SceneSaved = { kind: "ok"; summary: string[] } | { kind: "seen" } | { kind: "error"; message: string } | { kind: "none" };

/**
 * 비주얼노벨 장면 (docs/ui/Scene.dc.html, 명세서 「UI와 모바일」 5번).
 * 한 줄씩 넘기고(누르기·스페이스·엔터), 선택지를 고르고, 끝나면 결과를 한 번에 저장한다. 중간에 닫으면 아무것도 저장하지 않는다.
 */
export function SceneScreen(props: {
  scene: Scene;
  ctx: SceneContext;
  onFinish: (results: Extract<Frame, { kind: "end" }>["results"], choices: string[]) => Promise<SceneSaved>;
  onNext: (sceneId: string) => void;
  onClose: () => void;
}) {
  const { scene, ctx } = props;
  const [state, setState] = useState(() => {
    const step = advance(scene, startScene(scene), ctx);
    return { frame: step.frame, cursor: step.cursor, history: [] as Frame[] };
  });
  const [saved, setSaved] = useState<SceneSaved>();
  const [showLog, setShowLog] = useState(false);
  const { frame, cursor } = state;

  const go = (next: Cursor) => {
    const step = advance(scene, next, ctx);
    setState({ frame: step.frame, cursor: step.cursor, history: [...state.history, frame] });
  };
  const nextLine = () => {
    if (frame.kind === "line" || frame.kind === "pause") go(cursor);
  };

  // 끝나면 결과를 한 번에 저장
  useEffect(() => {
    if (frame.kind !== "end" || saved !== undefined) return;
    void props.onFinish(frame.results, cursor.choices).then(setSaved, (error: unknown) => setSaved({ kind: "error", message: String(error) }));
  }, [frame]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.code === "Space" || event.code === "Enter") && !event.repeat && (frame.kind === "line" || frame.kind === "pause")) {
        event.preventDefault();
        nextLine();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const stage = frame.stage;
  const shake = frame.effects.find((e) => e.cmd === "흔들림")?.arg;
  const speaker = frame.kind === "line" ? frame.speaker : undefined;

  return (
    <main class={`vn ${stage.dark ? "vn--dark" : ""} ${shake ? `vn--shake-${shake}` : ""}`} aria-label="장면">
      <header class="vn__bar">
        <button class="vn__close" type="button" onClick={props.onClose}>
          닫기
        </button>
        <span class="vn__place">{stage.background?.replaceAll("_", " ") ?? ""}</span>
        <button class="vn__close" type="button" aria-pressed={showLog} onClick={() => setShowLog(!showLog)}>
          지난 대사
        </button>
      </header>

      <p class="vn__bg">배경 그림 자리 · {stage.background?.replaceAll("_", " ") ?? "없음"}</p>
      {frame.effects
        .filter((e) => e.cmd !== "흔들림")
        .map((e, i) => (
          <p key={i} class="vn__effect">
            {e.cmd === "효과음" ? "♪ " : ""}
            {e.cmd} · {e.arg.replaceAll("_", " ")}
          </p>
        ))}

      <div class="vn__actors" aria-hidden="true">
        {Object.entries(stage.actors).map(([name, actor]) => (
          <div key={name} class={`vn__actor vn__actor--${actor.slot} ${name === speaker ? "vn__actor--speaking" : ""}`} title={`${name} (${actor.expr})`}>
            <svg viewBox="0 0 360 600" width="100%" height="100%">
              <ellipse cx="180" cy="112" rx="74" ry="84" fill="currentColor" />
              <path d="M60 600 Q70 300 180 230 Q290 300 300 600 Z" fill="currentColor" />
            </svg>
          </div>
        ))}
      </div>

      {frame.kind === "choice" && (
        <div class="vn__choices" role="group" aria-label="선택지">
          {frame.options.map((option) => (
            <button key={option.index} class="vn__choice" type="button" onClick={() => go(choose(scene, cursor, option.index))}>
              {option.text}
            </button>
          ))}
        </div>
      )}

      {frame.kind === "battle" && (
        <div class="vn__card" role="group" aria-label="장면 안 전투">
          <p>전투 「{frame.id}」 — 장면 안 전투는 준비 중이에요. 결과를 골라 이어 보세요.</p>
          {frame.outcomes.map((outcome: BattleOutcome) => (
            <button key={outcome} class="button" type="button" onClick={() => go(battleOutcome(scene, cursor, outcome))}>
              {outcome}
            </button>
          ))}
        </div>
      )}

      {frame.kind === "end" && (
        <div class="vn__card" role="group" aria-label="장면 끝">
          <p class="vn__card-title">장면 끝</p>
          {saved === undefined && <p>기록하는 중…</p>}
          {saved?.kind === "ok" && (saved.summary.length > 0 ? <ul>{saved.summary.map((line, i) => <li key={i}>{line}</li>)}</ul> : <p>이야기가 기록되었어요.</p>)}
          {saved?.kind === "seen" && <p>이미 본 장면이라 결과는 다시 들어가지 않아요.</p>}
          {saved?.kind === "none" && <p>캐릭터가 없어 결과를 기록하지 않았어요.</p>}
          {saved?.kind === "error" && <p class="vn__problem">기록하지 못했어요: {saved.message}</p>}
          <div class="vn__buttons">
            {frame.next !== undefined && saved !== undefined && (
              <button class="button button--main" type="button" onClick={() => props.onNext(frame.next!)}>
                이어서 보기
              </button>
            )}
            <button class="button" type="button" onClick={props.onClose}>
              닫기
            </button>
          </div>
        </div>
      )}

      {(frame.kind === "line" || frame.kind === "pause") && (
        <section class="vn__box" aria-label="대사창" onClick={nextLine}>
          {speaker !== undefined && <p class="vn__name">{speaker}</p>}
          {frame.kind === "line" ? (
            <p class={`vn__text ${frame.small ? "vn__text--small" : ""} ${speaker === undefined ? "vn__text--narration" : ""}`}>
              <Segments segments={frame.segments} />
            </p>
          ) : (
            <p class="vn__text vn__text--narration">{pauseText(frame.cmd, frame.arg)}</p>
          )}
          <button class="vn__next" type="button" aria-label="다음 대사" onClick={(e) => (e.stopPropagation(), nextLine())}>
            ▶
          </button>
        </section>
      )}

      {showLog && (
        <section class="vn__log" aria-label="지난 대사">
          {state.history
            .filter((f): f is Extract<Frame, { kind: "line" }> => f.kind === "line")
            .map((f, i) => (
              <p key={i}>
                {f.speaker !== undefined && <b>{f.speaker}: </b>}
                <Segments segments={f.segments} />
              </p>
            ))}
        </section>
      )}
    </main>
  );
}

function Segments(props: { segments: Segment[] }) {
  return (
    <>
      {props.segments.map((s, i) =>
        s.style ? (
          <span key={i} class={`vn__style vn__style--${s.style}`}>
            {s.text}
          </span>
        ) : (
          s.text
        ),
      )}
    </>
  );
}

/** 멈춤 명령: 그 화면이 생기기 전까지는 안내만 하고 넘어간다 */
function pauseText(cmd: string, arg: string): string {
  const name = arg.replaceAll("_", " ");
  if (cmd === "화면") return `〈${name}〉 화면은 아직 준비 중이에요. 넘기면 이어져요.`;
  if (cmd === "대기") return `〈${name}〉을 기다리는 자리예요. 지금은 넘기면 이어져요.`;
  if (cmd === "일생") return "〈지난 삶 요약〉을 넘겨 보는 자리예요. 도서관 홈의 「내 일생」에서 볼 수 있어요.";
  return `〈안내: ${name}〉 설명 카드는 아직 준비 중이에요.`;
}
