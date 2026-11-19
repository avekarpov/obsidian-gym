export interface PlanItem {
  name: string;
  sets: number;
  reps: number;
}

export interface Group {
  name: string;
  items: PlanItem[];
}

export interface SetRecord {
  exercise: string;
  weightKg: number | null;
  reps: number | null;
  skipped: number;
}

export interface Workout {
  start: string;
  group: string;
  end: string | null;
  current: string | null;
  records: SetRecord[];
}

export interface Parsed<T> {
  value: T;
  errors: string[];
}

const GROUP = /^##\s+(.+?)\s*$/;
const PLAN_ITEM = /^-\s+(.+):\s*(\d+)\s*[×xх]\s*(\d+)\s*$/;
const WORKOUT = /^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+·\s+(.+?)\s*$/;
const END = /^end:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/;
const CURRENT = /^current:\s*(.+?)\s*$/;
const RECORD = /^-\s+(.+):\s*(.+?)\s*$/;
const DONE = /^(\d+(?:[.,]\d+)?)\s*[×xх]\s*(\d+|\?)$/;
const SKIP = /^skip(?:\s*[×xх]\s*(\d+))?$/;

export function parsePlan(text: string): Parsed<Group[]> {
  const groups: Group[] = [];
  const errors: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const group = GROUP.exec(line);
    if (group) {
      groups.push({ name: group[1], items: [] });
      continue;
    }
    const item = PLAN_ITEM.exec(line);
    if (item && groups.length) {
      groups[groups.length - 1].items.push({ name: item[1].trim(), sets: Number(item[2]), reps: Number(item[3]) });
      continue;
    }
    errors.push(line);
  }
  return { value: groups, errors };
}

export function serializePlan(groups: Group[]): string {
  return groups
    .map((group) => [`## ${group.name}`, ...group.items.map((item) => `- ${item.name}: ${item.sets} × ${item.reps}`)].join("\n"))
    .join("\n\n");
}

export function parseDiary(text: string): Parsed<Workout[]> {
  const workouts: Workout[] = [];
  const errors: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const head = WORKOUT.exec(line);
    if (head) {
      workouts.push({ start: head[1], group: head[2], end: null, current: null, records: [] });
      continue;
    }
    const workout = workouts[workouts.length - 1];
    const end = END.exec(line);
    if (workout && end) {
      workout.end = end[1];
      continue;
    }
    const current = CURRENT.exec(line);
    if (workout && current) {
      workout.current = current[1];
      continue;
    }
    const record = RECORD.exec(line);
    const parsed = record ? parseRecordValue(record[2]) : null;
    if (workout && record && parsed) {
      workout.records.push({ exercise: record[1].trim(), ...parsed });
      continue;
    }
    errors.push(line);
  }
  return { value: workouts, errors };
}

function parseRecordValue(value: string): Omit<SetRecord, "exercise"> | null {
  const done = DONE.exec(value);
  if (done) {
    return { weightKg: Number(done[1].replace(",", ".")), reps: done[2] === "?" ? null : Number(done[2]), skipped: 0 };
  }
  const skip = SKIP.exec(value);
  if (skip) return { weightKg: null, reps: null, skipped: skip[1] ? Number(skip[1]) : 1 };
  return null;
}

export function serializeDiary(workouts: Workout[]): string {
  return workouts
    .map((workout) => {
      const lines = [`## ${workout.start} · ${workout.group}`];
      if (workout.end) lines.push(`end: ${workout.end}`);
      if (workout.current) lines.push(`current: ${workout.current}`);
      for (const record of workout.records) lines.push(`- ${record.exercise}: ${formatRecord(record)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatRecord(record: SetRecord): string {
  if (record.skipped) return record.skipped > 1 ? `skip ×${record.skipped}` : "skip";
  return `${formatNumber(record.weightKg ?? 0)}×${record.reps ?? "?"}`;
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function localStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function stampToDate(stamp: string): Date {
  const [day, time] = stamp.split(" ");
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

export function minutesBetween(start: string, end: string): number {
  return Math.round((stampToDate(end).getTime() - stampToDate(start).getTime()) / 60000);
}

export function findBlock(text: string, language: string): { start: number; end: number; content: string } | null {
  const pattern = new RegExp("^```" + language + "[ \\t]*\\n([\\s\\S]*?)^```[ \\t]*$", "m");
  const match = pattern.exec(text);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length, content: match[1].replace(/\n$/, "") };
}

export function replaceBlock(text: string, language: string, content: string): string {
  const block = "```" + language + "\n" + (content ? content + "\n" : "") + "```";
  const found = findBlock(text, language);
  if (!found) return (text.trimEnd() ? text.trimEnd() + "\n\n" : "") + block + "\n";
  return text.slice(0, found.start) + block + text.slice(found.end);
}
