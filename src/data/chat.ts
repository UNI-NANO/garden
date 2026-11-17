import type { Outgoing } from "../rules/chat";
import { expired } from "../rules/chat";
import type { Limits } from "../schema/defs/limits";
import type { DbPort } from "./commit";
import type { AdminPort } from "./migrate-write";

/** 구역 대화의 한 줄 (/chat/{구역}/{id}) */
export interface ChatLine {
  at: number;
  uid: string;
  cid: string;
  name: string;
  kind: "말" | "표정";
  text: string;
}

/** 귓속말 (/whispers/{cid}/{id}) */
export interface Whisper {
  at: number;
  uid: string;
  cid: string;
  name: string;
  to: string;
  toName: string;
  text: string;
}

export interface Speaker {
  uid: string;
  cid: string;
  name: string;
  zone: string;
}

/**
 * 한 줄을 보낸다. 말·표정은 구역에, 귓속말은 받는 사람과 보낸 사람의 귓속말함에 같은 쓰기로.
 * 같은 쓰기에서 /chatRate/{uid}를 이 시각으로 올린다(보안 규칙이 최소 간격을 본다). 규칙이 막으면 "denied".
 */
export async function sendChat(
  db: DbPort,
  me: Speaker,
  out: Exclude<Outgoing, { kind: "거절" }>,
  ctx: { now: number; id: string; to?: { cid: string; name: string } },
): Promise<"ok" | "denied"> {
  const base = { at: ctx.now, uid: me.uid, cid: me.cid, name: me.name };
  if (out.kind === "귓속말") {
    if (!ctx.to) throw new Error("귓속말 받는 사람이 없다");
    const whisper: Whisper = { ...base, to: ctx.to.cid, toName: ctx.to.name, text: out.text };
    return db.update({
      [`whispers/${ctx.to.cid}/${ctx.id}`]: whisper,
      ...(ctx.to.cid !== me.cid ? { [`whispers/${me.cid}/${ctx.id}`]: whisper } : {}),
      [`chatRate/${me.uid}`]: ctx.now,
    });
  }
  const line: ChatLine = { ...base, kind: out.kind, text: out.text };
  return db.update({ [`chat/${me.zone}/${ctx.id}`]: line, [`chatRate/${me.uid}`]: ctx.now });
}

/** 한 줄을 신고한다 (GM만 읽는다) */
export async function reportChat(db: DbPort, report: { by: string; zone: string; line: string; text: string; at: number }, id: string): Promise<"ok" | "denied"> {
  return db.update({ [`chatReports/${id}`]: report });
}

/** 하루 계산의 정리: 보관 기간이 지난 구역 대화와 귓속말을 지운다. 지운 줄 수 */
export async function cleanupChat(db: AdminPort, limits: Limits, now: number): Promise<number> {
  const updates: Record<string, null> = {};
  for (const root of ["chat", "whispers"]) {
    const boxes = ((await db.get(root)) ?? {}) as Record<string, Record<string, { at?: unknown }>>;
    for (const [box, lines] of Object.entries(boxes)) {
      for (const [id, line] of Object.entries(lines ?? {})) {
        if (typeof line?.at !== "number" || expired(line.at, now, limits)) updates[`${root}/${box}/${id}`] = null;
      }
    }
  }
  const count = Object.keys(updates).length;
  if (count > 0) await db.update(updates);
  return count;
}
