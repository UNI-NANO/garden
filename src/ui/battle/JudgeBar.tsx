import { useEffect, useRef, useState } from "preact/hooks";
import { barPosition, barZones, judgeAt, type BarWidths } from "../../rules/battle/judge";
import type { Judgement } from "../../schema/defs/skill-table";

/**
 * 판정 바 한 번. 커서가 왼쪽에서 오른쪽으로 한 번 지나가고, 아무 데나 누르거나 스페이스를 치면 그 자리로 판정한다.
 * 끝까지 누르지 않으면 빗나감.
 */
export function JudgeBar(props: {
  title: string;
  hitIndex: number;
  hitCount: number;
  widths: BarWidths;
  length: number;
  sweepMs: number;
  done: readonly Judgement[];
  onJudge: (judgement: Judgement) => void;
}) {
  const { widths, length, sweepMs, onJudge } = props;
  const [position, setPosition] = useState(0);
  const start = useRef(0);
  const finished = useRef(false);
  const pressRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    start.current = performance.now();
    finished.current = false;
    setPosition(0);
    const finish = (at: number | undefined) => {
      if (finished.current) return;
      finished.current = true;
      onJudge(judgeAt(widths, length, at));
    };
    const now = () => barPosition(performance.now() - start.current, sweepMs, length);
    let frame = 0;
    const tick = () => {
      const at = now();
      setPosition(at);
      if (at >= length) finish(undefined);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const press = () => finish(now());
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      event.preventDefault();
      press();
    };
    window.addEventListener("keydown", onKey);
    pressRef.current = press;
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
    };
    // 타가 바뀔 때마다 새로 시작한다
  }, [props.hitIndex]);

  const zones = barZones(widths, length);
  const pct = (x: number) => `${(Math.min(length, Math.max(0, x)) / length) * 100}%`;
  const span = ([from, to]: readonly [number, number]) => ({ left: pct(from), width: pct(Math.max(0, to - from)) });

  return (
    <div class="judge" role="dialog" aria-label="판정 바" onPointerDown={() => pressRef.current()}>
      <div class="judge__inner">
        <p class="judge__title">
          {props.title} <span class="judge__count">· {props.hitIndex + 1}타 / {props.hitCount}타</span>
        </p>
        <div class="judge__bar" data-position={Math.round(position * 10) / 10}>
          <div class="judge__zone judge__zone--normal" style={span(zones.normal)} />
          <div class="judge__zone judge__zone--good" style={span(zones.good)} />
          {widths.perfect > 0 && <div class="judge__zone judge__zone--perfect" style={span(zones.perfect)} />}
          <div class="judge__cursor" style={{ left: pct(position) }} />
        </div>
        <p class="judge__help">빗나감 · 보통 · 좋음 · 완벽 — 누르기: 아무 데나 / 스페이스</p>
        {props.done.length > 0 && <p class="judge__done">{props.done.join(" · ")}</p>}
      </div>
    </div>
  );
}
