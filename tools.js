// FamilyPulse tools. Responses are short, speakable sentences (voice has no scrolling).
import { ToolError } from "./mcp.js";
import { ymd, at, addDays, spoken, spokenHHMM, joinList } from "./clock.js";
import { polish } from "./llm.js";

const S = (description, extra = {}) => ({ type: "string", description, ...extra });
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

function findMember(state, name) {
  const q = String(name).trim().toLowerCase();
  const m = state.members.find((m) => m.name.toLowerCase() === q || m.aliases.includes(q))
    || state.members.find((m) => m.name.toLowerCase().startsWith(q));
  if (!m) throw new ToolError(`I don't know a family member called ${name}. The family is ${joinList(state.members.map((x) => x.name))}.`);
  return m;
}
const nameOf = (state, id) => state.members.find((m) => m.id === id)?.name ?? id;

function medStatus(state, member, filter, d) {
  const today = ymd(d);
  return state.schedules
    .filter((s) => s.member === member.id && (!filter || s.medication.toLowerCase().includes(filter.toLowerCase())))
    .map((s) => {
      const due = s.times.filter((t) => at(today, t) <= d);
      const upcoming = s.times.filter((t) => at(today, t) > d);
      const taken = state.doses.filter((x) => x.member === member.id && x.medication === s.medication && ymd(new Date(x.takenAt)) === today).length;
      const missedTimes = due.slice(Math.min(taken, due.length));
      return { medication: s.medication, due: due.length, taken, missedTimes, nextTime: upcoming[0] ?? null, today };
    });
}

function conflicts(state, day) {
  const evs = state.events.filter((e) => e.date === day && e.driver)
    .map((e) => ({ ...e, start: at(e.date, e.time) })).sort((a, b) => a.start - b.start);
  const out = [];
  for (let i = 0; i < evs.length; i++) for (let j = i + 1; j < evs.length; j++) {
    const a = evs[i], b = evs[j];
    if (a.driver === b.driver && b.start - a.start < a.durationMin * 60000) out.push([a, b]);
  }
  return out;
}

function loads(state) {
  const l = Object.fromEntries(state.members.filter((m) => m.canDoChores).map((m) => [m.id, 0]));
  for (const c of state.chores) if (c.member in l) l[c.member] += c.points;
  return l;
}

export const tools = [
  {
    name: "list_family_members",
    title: "List family members",
    description: "Lists the people in the household. Use first if a name is unclear.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
    async handler(_a, { store }) {
      const s = await store.read();
      return { text: `The family is ${joinList(s.members.map((m) => m.name))}.`, data: { members: s.members.map(({ id, name }) => ({ id, name })) } };
    },
  },
  {
    name: "assign_chore",
    title: "Assign a chore",
    description: "Assigns a new chore to a family member. Use when someone says 'give Leo the dishes' or 'Maya needs to walk the dog'.",
    inputSchema: {
      type: "object",
      properties: {
        member: S("Family member's name, e.g. Maya"),
        chore: S("Short chore title, e.g. Take out the trash"),
        due: S("When it is due", { enum: ["today", "tomorrow", "this week"] }),
        effort: { type: "integer", description: "Effort points 1 (quick) to 3 (big). Default 1." },
      },
      required: ["member", "chore"], additionalProperties: false,
    },
    annotations: writes,
    async handler({ member, chore, due = "today", effort = 1 }, { store, now }) {
      return store.update((s) => {
        const m = findMember(s, member);
        if (!m.canDoChores) throw new ToolError(`${m.name} isn't set up for chores. Try someone else.`);
        const d = now();
        const dueVal = due === "today" ? ymd(d) : due === "tomorrow" ? ymd(addDays(d, 1)) : "this week";
        const c = { id: `c${s.nextId++}`, member: m.id, title: chore, status: "pending", points: Math.min(3, Math.max(1, effort)), due: dueVal };
        s.chores.push(c);
        return { text: `Okay, ${chore} is assigned to ${m.name}, due ${due}.`, data: { chore: c } };
      });
    },
  },
  {
    name: "log_chore",
    title: "Mark a chore done",
    description: "Marks a chore as completed by a family member. If the chore wasn't assigned, it is recorded as done anyway.",
    inputSchema: {
      type: "object",
      properties: { member: S("Who did the chore"), chore: S("What they did, e.g. walked the dog") },
      required: ["member", "chore"], additionalProperties: false,
    },
    annotations: writes,
    async handler({ member, chore }, { store, now }) {
      return store.update((s) => {
        const m = findMember(s, member);
        const words = chore.toLowerCase().replace(/[^a-z ]/g, "").split(" ").filter((w) => w.length > 2 && !["the", "and"].includes(w));
        const match = s.chores.find((c) => c.member === m.id && c.status === "pending" && words.some((w) => c.title.toLowerCase().includes(w.replace(/ed$|ing$/, ""))));
        const d = now();
        if (match) {
          match.status = "done"; match.doneAt = d.toISOString();
          const left = s.chores.filter((c) => c.member === m.id && c.status === "pending").length;
          return { text: `Nice. I marked ${match.title} as done for ${m.name}. ${left ? `${m.name} has ${left} chore${left > 1 ? "s" : ""} left.` : `${m.name} is all caught up.`}`, data: { chore: match, remaining: left } };
        }
        const c = { id: `c${s.nextId++}`, member: m.id, title: chore, status: "done", points: 1, due: ymd(d), doneAt: d.toISOString() };
        s.chores.push(c);
        return { text: `I didn't have that one on the list, but I've recorded that ${m.name} did ${chore}.`, data: { chore: c } };
      });
    },
  },
  {
    name: "list_chores",
    title: "List chores",
    description: "Lists chores, optionally for one family member. Defaults to pending chores.",
    inputSchema: {
      type: "object",
      properties: { member: S("Optional family member"), status: S("Which chores", { enum: ["pending", "done", "all"] }) },
      additionalProperties: false,
    },
    annotations: readOnly,
    async handler({ member, status = "pending" }, { store }) {
      const s = await store.read();
      const m = member ? findMember(s, member) : null;
      const list = s.chores.filter((c) => (!m || c.member === m.id) && (status === "all" || c.status === status));
      if (!list.length) return { text: m ? `${m.name} has no ${status === "all" ? "" : status + " "}chores.` : `No ${status} chores.`, data: { chores: [] } };
      const by = {};
      for (const c of list) (by[c.member] ??= []).push(c.title);
      const text = Object.entries(by).map(([id, t]) => `${nameOf(s, id)}: ${joinList(t)}`).join(". ") + ".";
      return { text: `${status === "done" ? "Done" : "Pending"} chores. ${text}`, data: { chores: list } };
    },
  },
  {
    name: "log_medication",
    title: "Log a medication dose",
    description: "Records that a family member just took a medication. Use when someone says 'Grandpa took his evening pill'.",
    inputSchema: {
      type: "object",
      properties: { member: S("Who took it"), medication: S("Medication name, e.g. Metformin. Optional if they only have one.") },
      required: ["member"], additionalProperties: false,
    },
    annotations: writes,
    async handler({ member, medication }, { store, now }) {
      return store.update((s) => {
        const m = findMember(s, member);
        const mine = s.schedules.filter((x) => x.member === m.id);
        if (!mine.length) throw new ToolError(`${m.name} has no medication schedule on file.`);
        let sched = medication ? mine.find((x) => x.medication.toLowerCase().includes(medication.toLowerCase())) : (mine.length === 1 ? mine[0] : null);
        if (!sched) throw new ToolError(`Which medication? ${m.name} takes ${joinList(mine.map((x) => x.medication))}.`);
        const d = now();
        s.doses.push({ member: m.id, medication: sched.medication, takenAt: d.toISOString() });
        const st = medStatus(s, m, sched.medication, d)[0];
        const tail = st.missedTimes.length ? ` ${st.missedTimes.length} dose is still outstanding today.` : " That covers everything due so far today.";
        return { text: `Logged ${sched.medication} for ${m.name} at ${spoken(d)}.${tail}`, data: { logged: true, status: st } };
      });
    },
  },
  {
    name: "check_medication",
    title: "Check medication",
    description: "Answers whether a family member has taken their medication today, e.g. 'Did Grandpa take his evening pill?'.",
    inputSchema: {
      type: "object",
      properties: { member: S("Whose medication"), medication: S("Optional medication name") },
      required: ["member"], additionalProperties: false,
    },
    annotations: readOnly,
    async handler({ member, medication }, { store, now }) {
      const s = await store.read();
      const m = findMember(s, member);
      const d = now();
      const items = medStatus(s, m, medication, d);
      if (!items.length) return { text: `${m.name} has no ${medication ?? "medication"} schedule on file.`, data: { items: [] } };
      const sentences = items.map((x) => {
        if (x.missedTimes.length)
          return `${m.name} has taken ${x.taken} of ${x.due} ${x.medication} doses due so far today. The ${joinList(x.missedTimes.map((t) => spokenHHMM(x.today, t)))} dose hasn't been logged.`;
        if (x.due === 0) return `No ${x.medication} dose is due yet. The first is at ${spokenHHMM(x.today, x.nextTime)}.`;
        return `${m.name} is up to date on ${x.medication}.${x.nextTime ? ` The next dose is at ${spokenHHMM(x.today, x.nextTime)}.` : ""}`;
      });
      return { text: sentences.join(" "), data: { items } };
    },
  },
  {
    name: "daily_briefing",
    title: "Family briefing",
    description: "Speaks a short briefing: pending chores, outstanding medication, and tomorrow's schedule including driver conflicts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
    async handler(_a, { store, now }) {
      const s = await store.read();
      const d = now();
      const parts = [`${d.getHours() < 12 ? "Good morning" : d.getHours() < 17 ? "Good afternoon" : "Good evening"}. It's ${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`];
      const pending = {};
      for (const c of s.chores.filter((c) => c.status === "pending")) (pending[c.member] ??= []).push(c.title);
      const pc = Object.entries(pending);
      if (pc.length) parts.push("Pending chores: " + pc.map(([id, t]) => `${nameOf(s, id)} has ${joinList(t)}`).join("; ") + ".");
      for (const m of s.members) for (const x of medStatus(s, m, null, d)) if (x.missedTimes.length)
        parts.push(`${m.name}'s ${joinList(x.missedTimes.map((t) => spokenHHMM(x.today, t)))} ${x.medication} hasn't been logged.`);
      const tmr = ymd(addDays(d, 1));
      const evs = s.events.filter((e) => e.date === tmr).sort((a, b) => a.time.localeCompare(b.time));
      if (evs.length) parts.push("Tomorrow: " + joinList(evs.map((e) => `${nameOf(s, e.member)}'s ${e.title} at ${spokenHHMM(e.date, e.time)}`)) + ".");
      const cf = conflicts(s, tmr);
      for (const [a, b] of cf) parts.push(`Heads up: ${nameOf(s, a.member)}'s ${a.title} and ${nameOf(s, b.member)}'s ${b.title} both need ${nameOf(s, a.driver)} as driver, and they overlap.`);
      const base = parts.join(" ");
      const p = await polish(base, "Evening family briefing.");
      return { text: p.text, data: { source: p.source, facts: base, conflicts: cf.length } };
    },
  },
  {
    name: "suggest_rebalance",
    title: "Rebalance chores",
    description: "Compares each person's chore load and suggests moving one pending chore to even things out. Set apply=true to make the change.",
    inputSchema: { type: "object", properties: { apply: { type: "boolean", description: "Apply the suggestion. Default false." } }, additionalProperties: false },
    annotations: writes,
    async handler({ apply = false }, { store }) {
      return store.update(async (s) => {
        const l = loads(s);
        const ids = Object.keys(l).sort((a, b) => l[b] - l[a]);
        const hi = ids[0], lo = ids[ids.length - 1];
        if (l[hi] - l[lo] < 2) return { text: "Chores look fairly balanced already. No changes needed.", data: { loads: l } };
        const cand = s.chores.filter((c) => c.member === hi && c.status === "pending").sort((a, b) => b.points - a.points)[0];
        if (!cand) return { text: `${nameOf(s, hi)} has the most chores but they're all done.`, data: { loads: l } };
        const facts = `${nameOf(s, hi)} carries ${l[hi]} chore points this week and ${nameOf(s, lo)} only ${l[lo]}. Suggest moving "${cand.title}" from ${nameOf(s, hi)} to ${nameOf(s, lo)}.`;
        if (apply) { cand.member = lo; }
        const p = await polish(apply ? facts.replace("Suggest moving", "Moved") + " Done." : facts + " Say apply to confirm.", "Chore fairness.");
        return { text: p.text, data: { loads: l, moved: apply ? { chore: cand.title, from: hi, to: lo } : null, suggestion: { chore: cand.title, from: hi, to: lo }, source: p.source } };
      });
    },
  },
];
