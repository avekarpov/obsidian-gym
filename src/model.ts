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

export function parsePlan(text: string): Parsed<Group[]> {
  return parseJson(text, (data) => {
    if (!Array.isArray(data)) throw new Error("the plan must be a JSON array of groups");
    return data.map((group, i) => {
      if (!isObject(group) || typeof group.group !== "string" || !Array.isArray(group.exercises)) {
        throw new Error(`group #${i + 1} must have "group" and "exercises"`);
      }
      return {
        name: group.group,
        items: group.exercises.map((item, j) => {
          if (!isObject(item) || typeof item.name !== "string" || !isCount(item.sets) || !isCount(item.reps)) {
            throw new Error(`exercise #${j + 1} of "${group.group}" must have "name", "sets" and "reps"`);
          }
          return { name: item.name, sets: item.sets, reps: item.reps };
        }),
      };
    });
  });
}

export function serializePlan(groups: Group[]): string {
  if (!groups.length) return "[]";
  const body = groups.map((group) => {
    const items = group.items.map((item) => `    ${line({ name: item.name, sets: item.sets, reps: item.reps })}`);
    return `  {"group": ${JSON.stringify(group.name)}, "exercises": [${wrap(items)}]}`;
  });
  return `[\n${body.join(",\n")}\n]`;
}

export function parseDiary(text: string): Parsed<Workout[]> {
  return parseJson(text, (data) => {
    if (!Array.isArray(data)) throw new Error("the log must be a JSON array of workouts");
    return data.map((workout, i) => {
      if (!isObject(workout) || !isStamp(workout.start) || typeof workout.group !== "string" || !Array.isArray(workout.sets)) {
        throw new Error(`workout #${i + 1} must have "start", "group" and "sets"`);
      }
      if (workout.end !== undefined && !isStamp(workout.end)) {
        throw new Error(`workout #${i + 1}: "end" must be "YYYY-MM-DD HH:mm"`);
      }
      return {
        start: workout.start,
        end: (workout.end as string | undefined) ?? null,
        group: workout.group,
        current: typeof workout.current === "string" ? workout.current : null,
        records: workout.sets.map((set, j) => {
          if (!isObject(set) || typeof set.exercise !== "string") {
            throw new Error(`set #${j + 1} of workout #${i + 1} must have "exercise"`);
          }
          if (set.skip !== undefined) {
            if (!isCount(set.skip)) throw new Error(`set #${j + 1} of workout #${i + 1}: "skip" must be a whole number`);
            return { exercise: set.exercise, weightKg: null, reps: null, skipped: set.skip };
          }
          if (typeof set.weight !== "number" || (set.reps !== null && !isCount(set.reps))) {
            throw new Error(`set #${j + 1} of workout #${i + 1} must have "weight" and "reps"`);
          }
          return { exercise: set.exercise, weightKg: set.weight, reps: set.reps as number | null, skipped: 0 };
        }),
      };
    });
  });
}

export function serializeDiary(workouts: Workout[]): string {
  if (!workouts.length) return "[]";
  const body = workouts.map((workout) => {
    const head: Record<string, unknown> = { start: workout.start };
    if (workout.end) head.end = workout.end;
    head.group = workout.group;
    if (workout.current) head.current = workout.current;
    const sets = workout.records.map((record) => `    ${line(record.skipped
      ? { exercise: record.exercise, skip: record.skipped }
      : { exercise: record.exercise, weight: record.weightKg, reps: record.reps })}`);
    return `  ${line(head).slice(0, -1)}, "sets": [${wrap(sets)}]}`;
  });
  return `[\n${body.join(",\n")}\n]`;
}

function line(value: Record<string, unknown>): string {
  return "{" + Object.entries(value).map(([key, v]) => `${JSON.stringify(key)}: ${JSON.stringify(v)}`).join(", ") + "}";
}

function wrap(lines: string[]): string {
  return lines.length ? `\n${lines.join(",\n")}\n  ` : "";
}

function parseJson<T>(text: string, read: (data: unknown) => T[]): Parsed<T[]> {
  if (!text.trim()) return { value: [], errors: [] };
  try {
    return { value: read(JSON.parse(text)), errors: [] };
  } catch (error) {
    return { value: [], errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isStamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value);
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
