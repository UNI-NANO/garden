import { useEffect, useRef, useState } from "preact/hooks";
import type { DefenseInput, IncomingAttack } from "../../rules/battle/engine";
import { reactionResult, type BarWidths, type ReactionKind } from "../../rules/battle/judge";
import { Bar, useSweep } from "./JudgeBar";

const KINDS: { kind: ReactionKind; note: string }[] = [
  { kind: "막기", note: "판정 칸 넓음 · 피해 줄임 · 기력 +1" },
  { kind: "받아치기", note: "판정 칸 좁음 · 성공하면 반격" },
  { kind: "피하기", note: "큰 공격만 · 피해 없음 · 기력 +1" },
];

/**
 * 적 차례의 반응 하나 (docs/ui/Guard.dc.html). 막기·받아치기·피하기 가운데 고르면 판정 바가 지나가고,
 * 칸 안에서 누르면 성공. 제한 시간 안에 고르지 않으면 그냥 맞는다.
 */
export function Reaction(props: {
  attack: IncomingAttack;
  enemyName: string;
  allyName: string;
  turn: number;
  canDodge: boolean;
  seconds: number;
  length: number;
  sweepMs: number;
  widthsFor: (kind: ReactionKind) => BarWidths;
  onDone: (input: DefenseInput) => void;
}) {
  const [kind, setKind] = useState<ReactionKind>();
  const [left, setLeft] = useState(props.seconds);
  const doneRef = useRef(props.onDone);
  doneRef.current = props.onDone;

  // 고르기 전까지만 시간이 간다
  useEffect(() => {
    if (kind) return;
    const start = performance.now();
    const timer = setInterval(() => {
      const remain = props.seconds - (performance.now() - start) / 1000;
      setLeft(Math.max(0, Math.ceil(remain)));
      if (remain <= 0) {
        clearInterval(timer);
        doneRef.current("없음");
      }
    }, 200);
    return () => clearInterval(timer);
  }, [kind, props.seconds]);

  const { attack } = props;
  return (
    <div class="reaction" role="dialog" aria-label="반응">
      <header class="battle__bar reaction__bar">
        <span class="battle__turn">제{props.turn}턴 · 적 차례</span>
        <span class="battle__timer" aria-label="남은 시간">
          {kind ? "판정" : `${left}초`}
        </span>
      </header>
      <p class="reaction__who">
        {props.enemyName} → {props.allyName}
      </p>
      <p class="reaction__what">
        {attack.actionName} · {Math.round(attack.power * 10) / 10}
      </p>
      {kind ? (
        <ReactionBar kind={kind} widths={props.widthsFor(kind)} length={props.length} sweepMs={props.sweepMs} onDone={(input) => doneRef.current(input)} />
      ) : (
        <>
          <div class="reaction__choices">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                class="reaction__choice"
                type="button"
                disabled={k.kind === "피하기" && !props.canDodge}
                onClick={() => setKind(k.kind)}
              >
                <span class="reaction__name">{k.kind}</span>
                <span class="reaction__note">{k.kind === "피하기" && !props.canDodge ? "큰 공격이 아니거나 묶여 있음" : k.note}</span>
              </button>
            ))}
          </div>
          <p class="reaction__help">고르지 않으면 그냥 맞아요</p>
        </>
      )}
    </div>
  );
}

function ReactionBar(props: { kind: ReactionKind; widths: BarWidths; length: number; sweepMs: number; onDone: (input: DefenseInput) => void }) {
  const sweep = useSweep(props.kind, props.sweepMs, props.length, (at) => props.onDone(reactionResult(props.widths, props.length, props.kind, at)));
  return (
    <div class="reaction__judge" role="group" aria-label={`${props.kind} 판정 바`} onPointerDown={sweep.press}>
      <Bar widths={props.widths} length={props.length} position={sweep.position} />
      <p class="judge__help">칸 안에서 누르면 성공 — 누르기: 아무 데나 / 스페이스</p>
    </div>
  );
}
