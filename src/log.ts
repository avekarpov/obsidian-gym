import { App, MarkdownRenderChild, Notice } from "obsidian";
import { formatKg } from "./format";
import { LightDb } from "./lightdb";
import { ExerciseNotes } from "./notes";
import { openGymDb } from "./schema";
import { horizontalScroll } from "./scroll";
import { Exercise, loadExercises, loadSchemes } from "./workout";

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_W = 140;
const CHART_H = 32;
const CHART_PAD = 4;

interface Point {
  at: string;
  grams: number;
}

export class LogBlock extends MarkdownRenderChild {
  private open = new Set<string>();

  constructor(containerEl: HTMLElement, private app: App, private notes: ExerciseNotes) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    this.containerEl.addClass("gym-log");
    try {
      const db = await openGymDb(this.app);
      this.register(db.onChange(() => this.render(db)));
      this.register(this.notes.onChange(() => this.render(db)));
      this.render(db);
    } catch (error) {
      this.error(error);
    }
  }

  private error(error: unknown): void {
    this.containerEl.empty();
    this.containerEl.createDiv({ cls: "gym-error", text: error instanceof Error ? error.message : String(error) });
  }

  private render(db: LightDb): void {
    try {
      const root = this.containerEl;
      const exercises = loadExercises(db);
      this.notes.decorate(exercises);
      root.empty();
      root.createEl("h2", { text: "Progress" });
      this.renderProgress(root, db, exercises);
      root.createEl("h2", { text: "Workouts" });
      this.renderWorkouts(root, db, exercises);
    } catch (error) {
      this.error(error);
    }
  }

  private renderProgress(root: HTMLElement, db: LightDb, exercises: Map<string, Exercise>): void {
    const points = new Map<string, Point[]>();
    for (const r of db.all(`SELECT exercise_id, max(weight_g) AS grams, min(done_at) AS at
      FROM sets WHERE kind = 'work' AND skipped = 0 GROUP BY exercise_id, workout_id ORDER BY at`)) {
      const list = points.get(r.exercise_id as string) ?? [];
      list.push({ at: r.at as string, grams: r.grams as number });
      points.set(r.exercise_id as string, list);
    }
    if (!points.size) {
      root.createDiv({ cls: "gym-muted", text: "No workouts yet" });
      return;
    }
    const groups = loadSchemes(db).map((s) => ({ name: s.name, ids: s.exercises }));
    const grouped = new Set(groups.flatMap((g) => g.ids));
    groups.push({ name: "Other", ids: [...points.keys()].filter((id) => !grouped.has(id)) });

    for (const group of groups) {
      const ids = group.ids.filter((id) => points.has(id) && exercises.has(id));
      if (!ids.length) continue;
      root.createEl("h3", { text: group.name });
      const table = horizontalScroll(root).createEl("table", { cls: "gym-progress" });
      const head = table.createEl("thead").createEl("tr");
      for (const title of ["Exercise", "Trend", "Last", "Change"]) head.createEl("th", { text: title });
      const body = table.createEl("tbody");
      for (const id of ids) {
        const exercise = exercises.get(id)!;
        const series = points.get(id)!;
        const first = series[0].grams;
        const last = series[series.length - 1].grams;
        const tr = body.createEl("tr");
        tr.createEl("td", { text: exercise.name });
        this.renderChart(tr.createEl("td", { cls: "gym-trend" }), series);
        tr.createEl("td", { cls: "gym-num", text: `${formatKg(last)} kg` });
        const diff = last - first;
        tr.createEl("td", {
          cls: `gym-num ${diff > 0 ? "gym-up" : diff < 0 ? "gym-down" : ""}`,
          text: `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${formatKg(Math.abs(diff))}`,
        });
      }
    }
  }

  private renderChart(cell: HTMLElement, series: Point[]): void {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", String(CHART_W));
    svg.setAttribute("height", String(CHART_H));
    svg.setAttribute("viewBox", `0 0 ${CHART_W} ${CHART_H}`);
    cell.appendChild(svg);
    const caption = cell.createDiv({ cls: "gym-trend-caption" });

    const values = series.map((p) => p.grams);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const x = (i: number) => series.length === 1 ? CHART_W / 2 : CHART_PAD + (i * (CHART_W - 2 * CHART_PAD)) / (series.length - 1);
    const y = (g: number) => max === min ? CHART_H / 2 : CHART_H - CHART_PAD - ((g - min) * (CHART_H - 2 * CHART_PAD)) / (max - min);

    if (series.length > 1) {
      const line = document.createElementNS(SVG_NS, "polyline");
      line.setAttribute("points", series.map((p, i) => `${x(i)},${y(p.grams)}`).join(" "));
      line.setAttribute("class", "gym-trend-line");
      svg.appendChild(line);
    }
    series.forEach((p, i) => {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", String(x(i)));
      dot.setAttribute("cy", String(y(p.grams)));
      dot.setAttribute("r", "3");
      dot.setAttribute("class", "gym-trend-dot");
      const label = `${formatDate(p.at)}: ${formatKg(p.grams)} kg`;
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = label;
      dot.appendChild(title);
      dot.addEventListener("click", () => caption.setText(label));
      svg.appendChild(dot);
    });
  }

  private async deleteWorkout(db: LightDb, workoutId: string): Promise<void> {
    const sets = db.all("SELECT id FROM sets WHERE workout_id = ?", [workoutId]);
    try {
      await db.transaction([
        ...sets.map((s) => ({ op: "delete" as const, table: "sets", row: s.id as string })),
        { op: "delete" as const, table: "workouts", row: workoutId },
      ]);
      this.open.delete(workoutId);
    } catch (error) {
      new Notice(`Gym: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private renderWorkouts(root: HTMLElement, db: LightDb, exercises: Map<string, Exercise>): void {
    const schemeNames = new Map(loadSchemes(db).map((s) => [s.id, s.name]));
    const workouts = db.all("SELECT * FROM workouts ORDER BY started_at DESC");
    if (!workouts.length) {
      root.createDiv({ cls: "gym-muted", text: "No workouts yet" });
      return;
    }
    for (const w of workouts) {
      const id = w.id as string;
      const details = root.createEl("details", { cls: "gym-workout" });
      details.open = this.open.has(id);
      details.ontoggle = () => {
        if (details.open) this.open.add(id);
        else this.open.delete(id);
      };
      const names = (w.schemes as string).split(",").filter(Boolean).map((s) => schemeNames.get(s) ?? s).join(", ");
      const finished = w.finished_at as string | null;
      const duration = finished
        ? `${Math.round((Date.parse(finished) - Date.parse(w.started_at as string)) / 60000)} min`
        : "in progress";
      const title = `${formatDate(w.started_at as string)} · ${names} · ${duration}`;
      details.createEl("summary", { text: title });
      const remove = details.createDiv({ cls: "gym-workout-actions" }).createEl("button", { cls: "mod-warning", text: "Delete workout" });
      remove.onclick = () => {
        if (!window.confirm(`Delete workout ${title}? Its sets are deleted too.`)) return;
        void this.deleteWorkout(db, id);
      };

      const sets = db.all("SELECT exercise_id, kind, weight_g, reps FROM sets WHERE workout_id = ? AND skipped = 0 ORDER BY done_at", [id]);
      if (!sets.length) {
        details.createDiv({ cls: "gym-muted", text: "No sets" });
        continue;
      }
      const byExercise = new Map<string, { kind: string; grams: number; reps: number | null }[]>();
      for (const s of sets) {
        const list = byExercise.get(s.exercise_id as string) ?? [];
        list.push({ kind: s.kind as string, grams: s.weight_g as number, reps: s.reps as number | null });
        byExercise.set(s.exercise_id as string, list);
      }
      const list = details.createDiv({ cls: "gym-workout-sets" });
      for (const [exerciseId, items] of byExercise) {
        const row = list.createDiv({ cls: "gym-workout-row" });
        row.createSpan({ cls: "gym-workout-name", text: exercises.get(exerciseId)?.name ?? exerciseId });
        const weights = row.createSpan({ cls: "gym-num" });
        items.forEach((item, i) => {
          if (i > 0) weights.createSpan({ cls: "gym-muted", text: " · " });
          const text = item.reps === null ? formatKg(item.grams) : `${formatKg(item.grams)}×${item.reps}`;
          weights.createSpan({ cls: item.kind === "warmup" ? "gym-muted" : "", text });
        });
      }
    }
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}
