// Prediction journal, stored in this browser (localStorage).
// Resolved entries are scored with the Brier score: mean (p - outcome)^2.
// 0 is perfect, 0.25 is what always saying 50% gets you.

const KEY = 'oracle.journal.v1';

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(data) ? data.map(sanitize).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}/;

function sanitize(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const p = Number(e.p);
  if (typeof e.id !== 'string' || !e.id || !Number.isFinite(p)) return null;
  const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    ...e,
    id: e.id.slice(0, 100),
    p: Math.min(1, Math.max(0, p)),
    title: str(e.title) || str(e.question) || 'Untitled prediction',
    question: str(e.question),
    note: str(e.note, 500),
    createdAt: typeof e.createdAt === 'string' && DATE.test(e.createdAt) ? e.createdAt : new Date().toISOString(),
    resolveBy: typeof e.resolveBy === 'string' && DATE.test(e.resolveBy) ? e.resolveBy.slice(0, 10) : null,
    resolution: e.resolution === true || e.resolution === false ? e.resolution : null,
    model: e.model && typeof e.model === 'object' ? e.model : null,
    answers: e.answers && typeof e.answers === 'object' ? e.answers : {},
  };
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export const journal = {
  list() {
    // Open predictions first, newest first within each group.
    return read().sort((a, b) => (a.resolution !== null) - (b.resolution !== null) || b.createdAt.localeCompare(a.createdAt));
  },
  add(entry) {
    const list = read();
    const item = { id: crypto.randomUUID?.() || String(Date.now()), createdAt: new Date().toISOString(), resolution: null, ...entry };
    list.push(item);
    return write(list) ? item : null;
  },
  update(id, patch) {
    const list = read().map((e) => (e.id === id ? { ...e, ...patch } : e));
    write(list);
  },
  remove(id) {
    write(read().filter((e) => e.id !== id));
  },
  /** Merge imported entries (by id), repairing or dropping malformed ones. Returns the count kept. */
  importMany(list) {
    const clean = (Array.isArray(list) ? list : []).map(sanitize).filter(Boolean);
    const byId = new Map(read().map((e) => [e.id, e]));
    for (const e of clean) byId.set(e.id, e);
    return write([...byId.values()]) ? clean.length : 0;
  },
  stats() {
    const all = read();
    const resolved = all.filter((e) => e.resolution === true || e.resolution === false);
    const brier = resolved.length
      ? resolved.reduce((s, e) => s + (e.p - (e.resolution ? 1 : 0)) ** 2, 0) / resolved.length
      : null;
    const hits = resolved.filter((e) => (e.p >= 0.5) === e.resolution).length;
    const today = new Date().toISOString().slice(0, 10);
    const due = all.filter((e) => e.resolution === null && e.resolveBy && e.resolveBy <= today).length;
    const buckets = [0, 1, 2, 3, 4].map((i) => {
      const inB = resolved.filter((e) => Math.min(4, Math.floor(e.p * 5)) === i);
      return {
        range: [i / 5, (i + 1) / 5],
        n: inB.length,
        predicted: inB.length ? inB.reduce((s, e) => s + e.p, 0) / inB.length : null,
        actual: inB.length ? inB.filter((e) => e.resolution).length / inB.length : null,
      };
    });
    return { total: all.length, resolved: resolved.length, brier, accuracy: resolved.length ? hits / resolved.length : null, due, buckets };
  },
};
