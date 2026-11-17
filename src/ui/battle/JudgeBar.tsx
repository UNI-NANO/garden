import { useEffect, useRef, useState } from "preact/hooks";
import { barPosition, barZones, judgeAt, type BarWidths } from "../../rules/battle/judge";
import type { Judgement } from "../../schema/defs/skill-table";

/**
 * 커서가 왼쪽에서 오른쪽으로 한 번 지나가는 바. 아무 데나 누르거나 스페이스를 치면 그 자리, 끝까지 가면 undefined로 끝난다.
 * `runKey`가 바뀔 때마다 새로 시작한다.
 */
export function useSweep(runKey: string, sweepMs: number, length: number, onDone: (position: number | undefined) => void) {
  const [position, setPosition] = useState(0);
  const start = useRef(0);
  const finished = useRef(false);
  const pressRef = useRef<() => void>(() => undefined);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    start.current = performance.now();
    finished.current = false;
    setPosition(0);
    const finish = (at: number | undefined) => {
      if (finished.current) return;
      finished.current = true;
      doneRef.current(at);
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
  }, [runKey, sweepMs, length]);

  return { position, press: () => pressRef.current() };
}

/** 칸과 커서를 그린 바 */
export function Bar(props: { widths: BarWidths; length: number; position: number }) {
  const { widths, length } = props;
  const zones = barZones(widths, length);
  const pct = (x: number) => `${(Math.min(length, Math.max(0, x)) / length) * 100}%`;
  const span = ([from, to]: readonly [number, number]) => ({ left: pct(from), width: pct(Math.max(0, to - from)) });
  return (
    <div class="judge__bar" data-position={Math.round(props.position * 10) / 10}>
      {widths.normalEachSide > 0 && <div class="judge__zone judge__zone--normal" style={span(zones.normal)} />}
      <div class="judge__zone judge__zone--good" style={span(zones.good)} />
      {widths.perfect > 0 && <div class="judge__zone judge__zone--perfect" style={span(zones.perfect)} />}
      <div class="judge__cursor" style={{ left: pct(props.position) }} />
    </div>
  );
}

/** 공격의 판정 바 한 번. 끝까지 누르지 않으면 빗나감 */
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
  const { widths, length } = props;
  const sweep = useSweep(`hit-${props.hitIndex}`, props.sweepMs, length, (at) => props.onJudge(judgeAt(widths, length, at)));

  return (
    <div class="judge" role="dialog" aria-label="판정 바" onPointerDown={sweep.press}>
      <div class="judge__inner">
        <p class="judge__title">
          {props.title} <span class="judge__count">· {props.hitIndex + 1}타 / {props.hitCount}타</span>
        </p>
        <Bar widths={widths} length={length} position={sweep.position} />
        <p class="judge__help">빗나감 · 보통 · 좋음 · 완벽 — 누르기: 아무 데나 / 스페이스</p>
        {props.done.length > 0 && <p class="judge__done">{props.done.join(" · ")}</p>}
      </div>
    </div>
  );
}
