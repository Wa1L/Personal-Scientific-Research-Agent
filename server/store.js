// Tiny JSON-file datastore. Everything lives in memory and is flushed to
// data/db.json (atomically, debounced) after each mutation.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const empty = () => ({ topics: [], papers: [], analyses: [], activity: [] });

let db = empty();
try {
  db = { ...empty(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
} catch (err) {
  if (err.code !== "ENOENT") throw new Error(`Could not read ${DB_FILE}: ${err.message}`);
}

let timer = null;
function flush() {
  timer = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

export function save() {
  if (!timer) timer = setTimeout(flush, 150);
}

export function saveNow() {
  if (timer) clearTimeout(timer);
  flush();
}

export const newId = () => randomUUID().slice(0, 12);
export const data = () => db;

export function logActivity(topicId, message, level = "info") {
  db.activity.unshift({ id: newId(), at: new Date().toISOString(), topicId, message, level });
  db.activity.length = Math.min(db.activity.length, 200);
  save();
}

export const getTopic = (id) => db.topics.find((t) => t.id === id);
export const getPaper = (id) => db.papers.find((p) => p.id === id);
export const getAnalysis = (id) => db.analyses.find((a) => a.id === id);
export const topicPapers = (topicId) =>
  db.papers.filter((p) => p.topicIds.includes(topicId) && !p.excluded);
