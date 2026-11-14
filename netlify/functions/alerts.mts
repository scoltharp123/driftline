import type { Config } from "@netlify/functions";
import { allSubs, subs, configure, send, latestCfs, flowState } from "../lib/push.mjs";

// Every hour: check the flow on every watched river and tell people when a
// river comes into shape or blows out.
export default async () => {
  if (!configure()) return;
  const list = await allSubs();
  const cache = new Map<string, number | null>();
  for (const [key, rec] of list) {
    if (rec.flows === false || !rec.watch?.length) continue;
    let changed = false;
    for (const w of rec.watch) {
      if (!w.gauge) continue;
      if (!cache.has(w.gauge)) cache.set(w.gauge, await latestCfs(w.gauge));
      const cfs = cache.get(w.gauge) ?? null;
      if (w.dam && cfs != null) {
        rec.lastCfs = rec.lastCfs || {};
        const prevCfs = rec.lastCfs[w.id];
        if (prevCfs != null && Math.abs(cfs - prevCfs) >= Math.max(15, prevCfs * 0.2)) {
          const up = cfs > prevCfs;
          await send(key, rec, { title: `${w.dam} ${up ? "raised" : "cut"} releases`, body: `${w.name} went from ${Math.round(prevCfs)} to ${Math.round(cfs)} cfs in the last hour.${up ? " Expect the river to come up." : ""}`, url: `/#river-${w.id}`, tag: `dam-${w.id}` });
        }
        if (prevCfs !== cfs) { rec.lastCfs[w.id] = cfs; changed = true; }
      }
      const state = flowState(w, cfs);
      if (!state) continue;
      const before = rec.last?.[w.id];
      rec.last = rec.last || {};
      if (before !== state) {
        rec.last[w.id] = state;
        changed = true;
        if (!before) continue; // first reading: remember it, don't notify
        const n = Math.round(cfs!).toLocaleString("en-US");
        let msg: { title: string; body: string } | null = null;
        if (state === "fishable") msg = { title: `${w.name} is fishable`, body: `${n} cfs, inside your ${w.idealLo}–${w.idealHi} cfs range.` };
        else if (state === "blown") msg = { title: `${w.name} is blown out`, body: `${n} cfs. Give it a few days or fish somewhere else.` };
        else if (state === "high" && before === "fishable") msg = { title: `${w.name} is rising`, body: `${n} cfs, above the fishable range. Fish the edges.` };
        if (msg) await send(key, rec, { ...msg, url: `/#river-${w.id}`, tag: `flow-${w.id}` });
      }
    }
    if (changed) await subs().setJSON(key, rec);
  }
};

export const config: Config = {
  schedule: "17 * * * *", // hourly, at 17 minutes past (UTC)
};
