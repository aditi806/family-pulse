// Household state with pluggable backends: memory (tests/demo), JSON file (local), DynamoDB (AWS).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { now, ymd, addDays } from "./clock.js";

export function seed(d = now()) {
  const today = ymd(d), tomorrow = ymd(addDays(d, 1));
  const iso = (hhmm) => new Date(`${today}T${hhmm}:00`).toISOString();
  return {
    members: [
      { id: "dad", name: "Dad", aliases: ["papa", "father"], canDoChores: true },
      { id: "mom", name: "Mom", aliases: ["mama", "mother"], canDoChores: true },
      { id: "grandpa", name: "Grandpa", aliases: ["dada", "grandfather"], canDoChores: false },
      { id: "maya", name: "Maya", aliases: [], canDoChores: true },
      { id: "leo", name: "Leo", aliases: [], canDoChores: true },
    ],
    chores: [
      { id: "c1", member: "maya", title: "Walk the dog", status: "pending", points: 2, due: today },
      { id: "c2", member: "maya", title: "Clean her room", status: "pending", points: 2, due: "this week" },
      { id: "c3", member: "maya", title: "Set the dinner table", status: "done", points: 1, due: today, doneAt: iso("19:30") },
      { id: "c4", member: "maya", title: "Water the plants", status: "pending", points: 1, due: today },
      { id: "c5", member: "leo", title: "Take out the recycling", status: "pending", points: 1, due: today },
      { id: "c6", member: "leo", title: "Feed the dog", status: "done", points: 1, due: today, doneAt: iso("18:00") },
      { id: "c7", member: "mom", title: "Grocery shopping", status: "pending", points: 3, due: "this week" },
      { id: "c8", member: "dad", title: "Fix the porch light", status: "done", points: 2, due: today, doneAt: iso("17:00") },
      { id: "c9", member: "dad", title: "Wash the car", status: "pending", points: 2, due: "this week" },
    ],
    schedules: [
      { member: "grandpa", medication: "Metformin", times: ["08:00", "20:00"] },
      { member: "mom", medication: "Vitamin D", times: ["09:00"] },
    ],
    doses: [
      { member: "grandpa", medication: "Metformin", takenAt: iso("08:05") },
      { member: "mom", medication: "Vitamin D", takenAt: iso("09:10") },
    ],
    events: [
      { id: "e1", title: "piano lesson", member: "maya", date: tomorrow, time: "16:00", durationMin: 60, driver: "mom" },
      { id: "e2", title: "dentist appointment", member: "leo", date: tomorrow, time: "16:30", durationMin: 45, driver: "mom" },
      { id: "e3", title: "family dinner", member: "dad", date: tomorrow, time: "19:30", durationMin: 90, driver: null },
    ],
    nextId: 100,
  };
}

class MemoryBackend {
  constructor(initial) { this.s = initial; }
  async read() { return this.s ?? (this.s = seed()); }
  async write(s) { this.s = s; }
}
class FileBackend {
  constructor(file) { this.file = file; }
  async read() {
    if (!this.s) { try { this.s = JSON.parse(await readFile(this.file, "utf8")); } catch { this.s = seed(); } }
    return this.s;
  }
  async write(s) { this.s = s; await mkdir(dirname(this.file), { recursive: true }); await writeFile(this.file, JSON.stringify(s, null, 2)); }
}
// Whole household state kept in one item (small data, atomic read/modify/write per tool call).
class DynamoBackend {
  constructor(table) { this.table = table; this.key = { pk: { S: "household#default" } }; }
  async client() {
    if (!this.c) { const m = await import("@aws-sdk/client-dynamodb"); this.m = m; this.c = new m.DynamoDBClient({}); }
    return this.c;
  }
  async read() {
    const c = await this.client();
    const r = await c.send(new this.m.GetItemCommand({ TableName: this.table, Key: this.key }));
    return r.Item?.state?.S ? JSON.parse(r.Item.state.S) : seed();
  }
  async write(s) {
    const c = await this.client();
    await c.send(new this.m.PutItemCommand({ TableName: this.table, Item: { ...this.key, state: { S: JSON.stringify(s) } } }));
  }
}

export function createStore(backend) {
  let chain = Promise.resolve(); // serialize read-modify-write
  const run = (fn) => (chain = chain.then(fn, fn));
  return {
    read: () => run(async () => structuredClone(await backend.read())),
    update: (fn) => run(async () => {
      const s = await backend.read();
      const r = await fn(s);
      await backend.write(s);
      return r;
    }),
  };
}
export function storeFromEnv(env = process.env) {
  if (env.FAMILYPULSE_TABLE) return createStore(new DynamoBackend(env.FAMILYPULSE_TABLE));
  return createStore(new FileBackend(env.FAMILYPULSE_DATA || "data/state.json"));
}
export const memoryStore = (initial) => createStore(new MemoryBackend(initial));
