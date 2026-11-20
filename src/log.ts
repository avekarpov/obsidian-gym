import { App, MarkdownRenderChild, Notice } from "obsidian";
import { formatKg } from "./format";
import { onLanguageChange, t } from "./i18n";
import { minutesBetween, stampToDate, Workout } from "./model";
import { ExerciseNotes } from "./notes";
import { horizontalScroll } from "./scroll";
import { GymStore } from "./store";

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

  constructor(containerEl: HTMLElement, private app: App, private store: GymStore, private notes: ExerciseNotes) {
    super(containerEl);
  }

  onload(): void {
    this.containerEl.addClass("gym-log");
    this.register(this.store.onChange(() => this.render()));
    this.register(this.notes.onChange(() => this.render()));
    this.register(onLanguageChange(() => this.render()));
    this.render();
  }

  private render(): void {
    const root = this.containerEl;
    root.empty();
    for (const line of this.store.diaryErrors) {
      root.createDiv({ cls: "gym-error", text: t("Invalid data: {error}", { error: line }) });
    }
    root.createEl("h2", { text: t("Progress") });
    this.renderProgress(root);
    root.createEl("h2", { text: t("Workouts") });
    this.renderWorkouts(root);
  }

  private renderProgress(root: HTMLElement): void {
    const points = new Map<string, Point[]>();
    for (const workout of [...this.store.diary].reverse()) {
      const best = new Map<string, number>();
      for (const record of workout.records) {
        if (record.skipped) continue;
        const grams = Math.round((record.weightKg ?? 0) * 1000);
        best.set(record.exercise, Math.max(best.get(record.exercise) ?? 0, grams));
      }
      for (const [exercise, grams] of best) {
        const list = points.get(exercise) ?? [];
        list.push({ at: workout.start, grams });
        points.set(exercise, list);
      }
    }
    if (!points.size) {
      root.createDiv({ cls: "gym-muted", text: t("No workouts yet") });
      return;
    }
    const groups = this.store.plan.map((g) => ({ name: g.name, names: g.items.map((i) => i.name) }));
    const grouped = new Set(groups.flatMap((g) => g.names));
    groups.push({ name: t("Other"), names: [...points.keys()].filter((name) => !grouped.has(name)) });

    for (const group of groups) {
      const names = group.names.filter((name) => points.has(name));
      if (!names.length) continue;
      root.createEl("h3", { text: group.name });
      const table = horizontalScroll(root).createEl("table", { cls: "gym-progress" });
      const head = table.createEl("thead").createEl("tr");
      for (const title of ["Exercise", "Trend", "Last", "Change"]) head.createEl("th", { text: t(title) });
      const body = table.createEl("tbody");
      for (const name of names) {
        const series = points.get(name)!;
        const first = series[0].grams;
        const last = series[series.length - 1].grams;
        const tr = body.createEl("tr");
        tr.createEl("td", { text: name });
        this.renderChart(tr.createEl("td", { cls: "gym-trend" }), series);
        tr.createEl("td", { cls: "gym-num", text: t("{kg} kg", { kg: formatKg(last) }) });
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

  private async deleteWorkout(workout: Workout): Promise<void> {
    try {
      await this.store.updateDiary((diary) => {
        const index = diary.findIndex((w) => w.start === workout.start && w.group === workout.group);
        if (index >= 0) diary.splice(index, 1);
      });
      this.open.delete(workout.start);
    } catch (error) {
      new Notice(`Gym: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private renderWorkouts(root: HTMLElement): void {
    if (!this.store.diary.length) {
      root.createDiv({ cls: "gym-muted", text: t("No workouts yet") });
      return;
    }
    for (const workout of this.store.diary) {
      const key = workout.start;
      const details = root.createEl("details", { cls: "gym-workout" });
      details.open = this.open.has(key);
      details.ontoggle = () => {
        if (details.open) this.open.add(key);
        else this.open.delete(key);
      };
      const duration = workout.end
        ? t("{minutes} min", { minutes: minutesBetween(workout.start, workout.end) })
        : t("in progress");
      const title = `${formatDate(workout.start)} · ${workout.group} · ${duration}`;
      const summary = details.createEl("summary");
      summary.createSpan({ cls: "gym-workout-title", text: title });
      const remove = summary.createEl("button", { cls: "mod-warning", text: t("Delete") });
      remove.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!window.confirm(t("Delete workout {title}? Its sets are deleted too.", { title }))) return;
        void this.deleteWorkout(workout);
      };

      if (workout.comment) details.createDiv({ cls: "gym-workout-comment", text: workout.comment });
      const done = workout.records.filter((record) => !record.skipped);
      if (!done.length) {
        details.createDiv({ cls: "gym-muted", text: t("No sets") });
        continue;
      }
      const byExercise = new Map<string, string[]>();
      for (const record of done) {
        const list = byExercise.get(record.exercise) ?? [];
        const grams = Math.round((record.weightKg ?? 0) * 1000);
        list.push(record.reps === null ? formatKg(grams) : `${formatKg(grams)}×${record.reps}`);
        byExercise.set(record.exercise, list);
      }
      const list = details.createDiv({ cls: "gym-workout-sets" });
      for (const [exercise, items] of byExercise) {
        const row = list.createDiv({ cls: "gym-workout-row" });
        row.createSpan({ cls: "gym-workout-name", text: exercise });
        const weights = row.createSpan({ cls: "gym-num" });
        items.forEach((text, i) => {
          if (i > 0) weights.createSpan({ cls: "gym-muted", text: " · " });
          weights.createSpan({ text });
        });
      }
    }
  }
}

function formatDate(stamp: string): string {
  return stampToDate(stamp).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}
