import { limitToLast, onValue, orderByChild, push, query, ref } from "firebase/database";
import { useEffect, useRef, useState } from "preact/hooks";
import { reportChat, sendChat, type ChatLine, type Whisper } from "../data/chat";
import type { Firebase } from "../data/firebase-app";
import { firebasePort } from "../data/firebase-port";
import { reportError } from "../data/session";
import { chatCooldown, LIBRARY_ZONE, parseOutgoing, recentLines, zoneLabel } from "../rules/chat";
import type { Character } from "../schema/character";
import type { Limits } from "../schema/defs/limits";
import { Paper } from "./parts";

type Shown = (ChatLine & { id: string; whisper?: false }) | (Whisper & { id: string; whisper: true });

/**
 * 구역 대화 (명세서 「구역 대화」). 같은 구역(장소 하나, 위치가 없으면 도서관)의 사람끼리.
 * 들어오면 지난 대사, /표정, /귓 이름 말, 줄마다 신고. 너무 빨리 보내면 잠시 막힌다.
 */
export function ChatPanel(props: { fb: Firebase; limits: Limits; uid: string; characterId: string; character: Character }) {
  const { fb, limits, character } = props;
  const location = character.profile.location;
  // 보안 규칙과 같은 기준: 위치에 구역 키가 없으면 도서관
  const zone = location?.zone ?? LIBRARY_ZONE;
  const label = location?.zone ? zoneLabel(location) : zoneLabel(undefined);
  const [lines, setLines] = useState<Shown[]>([]);
  const [whispers, setWhispers] = useState<Shown[]>([]);
  const [text, setText] = useState("");
  /** 최근 보낸 시각들 (화면이 다시 그려지기 전에도 바로 맞는 값) */
  const sentRef = useRef<number[]>([]);
  const [notice, setNotice] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const n = limits.chat.historyLines;
    const stopZone = onValue(
      query(ref(fb.db, `chat/${zone}`), orderByChild("at"), limitToLast(n)),
      (snap) => setLines(Object.entries((snap.val() ?? {}) as Record<string, ChatLine>).map(([id, line]) => ({ ...line, id }))),
      (error) => reportError(fb, error, "구역 대화 읽기"),
    );
    const stopWhisper = onValue(
      query(ref(fb.db, `whispers/${props.characterId}`), orderByChild("at"), limitToLast(n)),
      (snap) => setWhispers(Object.entries((snap.val() ?? {}) as Record<string, Whisper>).map(([id, w]) => ({ ...w, id, whisper: true as const }))),
      (error) => reportError(fb, error, "귓속말 읽기"),
    );
    return () => {
      stopZone();
      stopWhisper();
    };
  }, [fb, zone, props.characterId]);

  const cooldown = chatCooldown(sentRef.current, now, limits);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  const shown = recentLines([...lines, ...whispers], limits);
  /** 귓속말 받는 사람: 이 구역에서 최근 말한 사람 */
  const speakers = new Map(lines.filter((l) => l.cid !== props.characterId).map((l) => [l.name, l.cid]));

  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await sendNow();
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    setNotice(undefined);
    if (chatCooldown(sentRef.current, Date.now(), limits) > 0) return;
    // 보안 규칙의 최소 간격: 막히지 않게 남은 만큼 기다렸다 보낸다
    const last = sentRef.current.at(-1);
    const gap = last === undefined ? 0 : last + limits.chat.minGapMs - Date.now();
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    const at = Date.now();
    setNow(at);
    const out = parseOutgoing(text, limits);
    if (out.kind === "거절") return setNotice(out.reason);
    const toCid = out.kind === "귓속말" ? speakers.get(out.to) : undefined;
    if (out.kind === "귓속말" && !toCid) return setNotice("이 구역에서 최근 말한 사람에게만 귓속말할 수 있어요.");
    try {
      const id = push(ref(fb.db, "chat")).key ?? `m${at}`;
      const result = await sendChat(firebasePort(fb.db), { uid: props.uid, cid: props.characterId, name: character.profile.name, zone }, out, {
        now: at,
        id,
        ...(toCid && out.kind === "귓속말" ? { to: { cid: toCid, name: out.to } } : {}),
      });
      if (result === "ok") {
        sentRef.current = [...sentRef.current, at].slice(-limits.chat.burstLines);
        setNow(Date.now());
        setText("");
      } else setNotice("보내지 못했어요. 말이 막혔거나, 너무 빨랐거나, 구역이 바뀌었어요.");
    } catch (error) {
      reportError(fb, error, "구역 대화 보내기");
      setNotice("보내지 못했어요. 잠시 뒤 다시 해 주세요.");
    }
  };

  const report = async (line: Shown) => {
    try {
      const id = push(ref(fb.db, "chatReports")).key ?? `r${Date.now()}`;
      const result = await reportChat(firebasePort(fb.db), { by: props.uid, zone, line: line.id, text: line.text, at: Date.now() }, id);
      setNotice(result === "ok" ? "신고했어요. GM이 볼게요." : "신고하지 못했어요.");
    } catch (error) {
      reportError(fb, error, "구역 대화 신고");
    }
  };

  const length = text.length;
  return (
    <Paper class="chat" label="구역 대화">
      <h2 class="chat__title">구역 대화 · {label}</h2>
      <ol class="chat__lines" aria-live="polite">
        {shown.length === 0 && <li class="chat__empty">아직 아무도 말하지 않았어요.</li>}
        {shown.map((line) => (
          <li key={`${line.whisper ? "w" : "c"}${line.id}`} class={`chat__line ${line.whisper ? "chat__line--whisper" : ""}`}>
            {line.whisper ? (
              <span>
                <b>{line.cid === props.characterId ? `→ ${line.toName}` : `${line.name} →`}</b> (귓속말) {line.text}
              </span>
            ) : line.kind === "표정" ? (
              <span class="chat__emote">
                {line.name} ({line.text})
              </span>
            ) : (
              <span>
                <b>{line.name}</b>: {line.text}
              </span>
            )}
            {!line.whisper && line.cid !== props.characterId && (
              <button class="chat__report" type="button" aria-label={`${line.name}의 말 신고`} onClick={() => void report(line)}>
                신고
              </button>
            )}
          </li>
        ))}
      </ol>
      <form
        class="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          class="chat__input"
          aria-label="할 말"
          placeholder="말하기 · /표정 웃음 · /귓 이름 할 말"
          value={text}
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        />
        <span class={`chat__count ${length > limits.chat.maxLength ? "chat__count--over" : ""}`}>
          {length}/{limits.chat.maxLength}
        </span>
        <button class="button" type="submit" disabled={cooldown > 0 || busy}>
          {cooldown > 0 ? `${Math.ceil(cooldown / 1000)}초 뒤에` : "보내기"}
        </button>
      </form>
      {notice && <p class="chat__notice">{notice}</p>}
    </Paper>
  );
}
