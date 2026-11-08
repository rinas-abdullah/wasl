import { sql } from "drizzle-orm";
import { db, type Tx } from "../db/client";
import { schema } from "../db/client";
import { bus, type LiveMessage } from "../http/bus";
import { eq } from "drizzle-orm";

export interface TxCtx {
  tx: Tx;
  /** Queue a live message to publish after commit. */
  live(msg: Omit<LiveMessage, "at">): void;
  /** Queue a callback to run after commit (never inside the transaction). */
  after(fn: () => void | Promise<void>): void;
}

export async function withTx<T>(fn: (ctx: TxCtx) => Promise<T>): Promise<T> {
  const msgs: Omit<LiveMessage, "at">[] = [];
  const afters: (() => void | Promise<void>)[] = [];
  const result = await db.transaction(async (tx) => fn({ tx, live: (m) => msgs.push(m), after: (f) => afters.push(f) }));
  for (const m of msgs) bus.publish(m);
  for (const f of afters) {
    try {
      await f();
    } catch (err) {
      console.error("[after-commit]", err);
    }
  }
  return result;
}

/** Bumps the facility operational state version (used to detect stale optimisation plans). */
export async function bumpState(tx: Tx, facilityId: string) {
  await tx.update(schema.facilities).set({ stateVersion: sql`${schema.facilities.stateVersion} + 1` }).where(eq(schema.facilities.id, facilityId));
}
