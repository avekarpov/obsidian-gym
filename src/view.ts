import { App, MarkdownRenderChild } from "obsidian";
import { formatKg } from "./format";
import { locale, onLanguageChange, t } from "./i18n";
import { localTime, minutesBetween, stampToDate, utcStamp, Workout } from "./model";
import { ExerciseNotes } from "./notes";
import { bindWeightDrag } from "./scale";
import { GymStore } from "./store";
import { buildSteps, doneSetCount, pickStep, previousSets, setsTaken, startValues, Step } from "./workout";

type Mode = { kind: "choose" } | { kind: "finished"; start: string };

export class GymBlock extends MarkdownRenderChild {
  private mode: Mode = { kind: "choose" };
  private weight: { key: string; grams: number; reps: number } | null = null;
  private dragging = false;
  private renderPending = false;
  private busy = false;
  private switching = false;
  private comment: { start: string; text: string } | null = null;

  constructor(
    containerEl: HTMLElement,
    private app: App,
    private store: GymStore,
    private notes: ExerciseNotes,
    private recentCount: () => number,
  ) {
    super(containerEl);
  }

  onload(): void {
    this.containerEl.addClass("gym");
    this.register(this.store.onChange(() => this.render()));
    this.register(this.notes.onChange(() => this.render()));
    this.register(onLanguageChange(() => this.render()));
    this.render();
  }

  private message(text: string): void {
    this.containerEl.empty();
    this.containerEl.createDiv({ cls: "gym-error", text });
  }

  private render(): void {
    if (this.dragging) {
      this.renderPending = true;
      return;
    }
    const root = this.containerEl;
    root.empty();
    const active = this.store.activeWorkout();
    if (active) return this.renderStep(root, active);
    this.switching = false;
    if (this.mode.kind === "finished") return this.renderFinished(root, this.mode.start);
    this.renderChoose(root);
  }

  private renderChoose(root: HTMLElement): void {
    root.createDiv({ cls: "gym-title", text: t("What are we training?") });
    const list = root.createDiv({ cls: "gym-schemes" });
    for (const group of this.store.plan.filter((g) => g.items.length > 0)) {
      list.createEl("button", { cls: "gym-primary gym-big", text: group.name }).onclick = () => this.run(async () => {
        this.mode = { kind: "choose" };
        await this.store.updateDiary((diary) => {
          diary.unshift({ start: utcStamp(), group: group.name, end: null, current: null, comment: null, records: [] });
        });
      });
    }
    this.renderRecent(root);
  }

  private renderRecent(root: HTMLElement): void {
    const count = this.recentCount();
    if (count <= 0) return;
    const recent = this.store.diary.filter((w) => w.end).slice(0, count);
    if (!recent.length) return;
    const box = root.createDiv({ cls: "gym-previous" });
    box.createDiv({ cls: "gym-previous-title", text: t("Recent workouts") });
    const table = box.createEl("table");
    const head = table.createEl("thead").createEl("tr");
    for (const title of [t("Date"), t("Workout")]) head.createEl("th", { text: title });
    const body = table.createEl("tbody");
    for (const workout of recent) {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: stampToDate(workout.start).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", weekday: "short" }) });
      tr.createEl("td", { text: workout.group });
    }
  }

  private renderStep(root: HTMLElement, workout: Workout): void {
    const group = this.store.plan.find((g) => g.name === workout.group);
    const steps = buildSteps(group);
    const step = pickStep(steps, workout);
    if (!step) {
      if (!group) {
        this.message(t("Group \"{group}\" is not in the plan", { group: workout.group }));
        this.renderEnd(root, workout);
        return;
      }
      void this.finish(workout);
      return;
    }
    if (this.switching) return this.renderSwitch(root, steps, workout, step);
    const key = `${workout.start}|${step.item.name}|${step.setNo}`;
    if (this.weight?.key !== key) this.weight = { key, ...startValues(this.store.diary, workout, step.item) };
    const weight = this.weight;

    const header = root.createDiv({ cls: "gym-header" });
    header.createSpan({ text: t("{group} · exercise {n} of {total}", { group: workout.group, n: exerciseOrdinal(workout, step.item.name), total: step.exerciseCount }) });
    header.createSpan({ text: t("started {time}", { time: localTime(workout.start) }) });

    const name = root.createDiv({ cls: "gym-exercise", text: step.item.name });
    const note = this.notes.pathOf(step.item.name);
    if (note) {
      name.addClass("gym-link");
      name.onclick = () => void this.app.workspace.openLinkText(note, "", false);
    }
    root.createDiv({ cls: "gym-set", text: setLabel(step) });

    const row = root.createDiv({ cls: "gym-weight-row" });
    const value = row.createDiv({ cls: "gym-weight" });
    const showWeight = () => {
      value.empty();
      value.createSpan({ cls: "gym-weight-number", text: formatKg(weight.grams) });
      value.createSpan({ cls: "gym-weight-unit", text: t("kg") });
    };
    showWeight();
    bindWeightDrag(value, weight, showWeight, {
      onStart: () => (this.dragging = true),
      onEnd: () => {
        this.dragging = false;
        if (this.renderPending) {
          this.renderPending = false;
          this.render();
        }
      },
    });

    const repsRow = root.createDiv({ cls: "gym-reps-row" });
    const minus = repsRow.createEl("button", { cls: "gym-reps-button", text: "−" });
    const repsValue = repsRow.createDiv({ cls: "gym-reps" });
    const plus = repsRow.createEl("button", { cls: "gym-reps-button", text: "+" });
    const showReps = () => {
      repsValue.empty();
      repsValue.createSpan({ cls: "gym-reps-number", text: String(weight.reps) });
      repsValue.createSpan({ cls: "gym-weight-unit", text: t("reps") });
      minus.disabled = weight.reps <= 1;
    };
    showReps();
    minus.onclick = () => {
      weight.reps = Math.max(1, weight.reps - 1);
      showReps();
    };
    plus.onclick = () => {
      weight.reps += 1;
      showReps();
    };

    const exercise = step.item.name;
    const left = step.item.sets - setsTaken(workout, exercise);
    const record = (skipped: number) => this.run(async () => {
      let finished = false;
      await this.store.updateDiary((diary) => {
        const target = diary.find((w) => w.start === workout.start && !w.end);
        if (!target) return;
        target.records.push(skipped
          ? { exercise, weightKg: null, reps: null, skipped }
          : { exercise, weightKg: weight.grams / 1000, reps: weight.reps, skipped: 0 });
        if (!pickStep(steps, target, exercise)) {
          target.end = utcStamp();
          target.current = null;
          finished = true;
        }
      });
      if (finished) this.mode = { kind: "finished", start: workout.start };
    });

    root.createEl("button", { cls: "gym-primary gym-big", text: t("Done") }).onclick = () => record(0);
    const skips = root.createDiv({ cls: "gym-skips" });
    skips.createEl("button", { text: t("Skip set") }).onclick = () => record(1);
    skips.createEl("button", { text: t("Skip exercise") }).onclick = () => record(left);

    const extra = root.createDiv({ cls: "gym-skips" });
    const last = workout.records.at(-1);
    const undo = extra.createEl("button", { text: t("Undo last set") });
    undo.disabled = !last;
    undo.onclick = () => {
      if (!last) return;
      void this.run(async () => {
        await this.store.updateDiary((diary) => {
          const target = diary.find((w) => w.start === workout.start && !w.end);
          if (!target) return;
          target.records.pop();
          target.current = last.exercise;
        });
        const item = group?.items.find((i) => i.name === last.exercise);
        const setNo = setsTaken({ ...workout, records: workout.records.slice(0, -1) }, last.exercise) + 1;
        this.weight = {
          key: `${workout.start}|${last.exercise}|${setNo}`,
          grams: last.skipped ? weight.grams : Math.round((last.weightKg ?? 0) * 1000),
          reps: last.reps ?? item?.reps ?? weight.reps,
        };
      });
    };
    extra.createEl("button", { text: t("Change exercise") }).onclick = () => {
      this.switching = true;
      this.render();
    };

    const after = { ...workout, records: [...workout.records, { exercise, weightKg: 0, reps: 0, skipped: 0 }] };
    const next = pickStep(steps, after, exercise);
    if (next) {
      root.createDiv({
        cls: "gym-next",
        text: next.item.name === exercise ? t("Next: set {n}", { n: next.setNo }) : t("Next: {name}", { name: next.item.name }),
      });
    }

    this.renderPrevious(root, workout, exercise);
    this.renderEnd(root, workout);
  }

  private renderEnd(root: HTMLElement, workout: Workout): void {
    root.createEl("button", { cls: "gym-end", text: t("End workout") }).onclick = () => {
      if (!window.confirm(t("End the workout now?"))) return;
      void this.finish(workout);
    };
  }

  private async finish(workout: Workout): Promise<void> {
    await this.run(async () => {
      this.mode = { kind: "finished", start: workout.start };
      await this.store.updateDiary((diary) => {
        const target = diary.find((w) => w.start === workout.start && !w.end);
        if (!target) return;
        target.end = utcStamp();
        target.current = null;
      });
    });
  }

  private renderSwitch(root: HTMLElement, steps: Step[], workout: Workout, current: Step): void {
    root.createDiv({ cls: "gym-title", text: t("Change exercise") });
    const list = root.createDiv({ cls: "gym-switch-list" });
    const items = [...new Map(steps.map((s) => [s.item.name, s.item])).values()];
    for (const item of items) {
      const taken = Math.min(setsTaken(workout, item.name), item.sets);
      const button = list.createEl("button", { cls: "gym-switch-item" });
      if (item.name === current.item.name) button.addClass("is-current");
      button.createSpan({ text: item.name });
      button.createSpan({ cls: "gym-switch-progress", text: taken === item.sets ? t("done") : `${taken}/${item.sets}` });
      button.disabled = taken === item.sets;
      button.onclick = () => {
        this.switching = false;
        if (item.name === current.item.name) {
          this.render();
          return;
        }
        void this.run(() => this.store.updateDiary((diary) => {
          const target = diary.find((w) => w.start === workout.start && !w.end);
          if (target) target.current = item.name;
        }));
      };
    }
    root.createEl("button", { text: t("Back") }).onclick = () => {
      this.switching = false;
      this.render();
    };
  }

  private renderPrevious(root: HTMLElement, workout: Workout, exercise: string): void {
    const box = root.createDiv({ cls: "gym-previous" });
    const previous = previousSets(this.store.diary, exercise, workout);
    if (!previous) {
      box.createDiv({ cls: "gym-previous-title", text: t("No previous workouts with this exercise") });
      return;
    }
    const day = stampToDate(previous.start).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
    box.createDiv({ cls: "gym-previous-title", text: t("Last time · {date}", { date: day }) });
    const table = box.createEl("table");
    const head = table.createEl("thead").createEl("tr");
    for (const title of ["#", t("kg"), t("reps")]) head.createEl("th", { text: title });
    const body = table.createEl("tbody");
    let n = 0;
    for (const record of previous.records) {
      for (let i = 0; i < (record.skipped || 1); i++) {
        n++;
        const tr = body.createEl("tr", { cls: record.skipped ? "gym-previous-skipped" : "" });
        tr.createEl("td", { text: String(n) });
        if (record.skipped) {
          tr.createEl("td", { text: t("skipped"), attr: { colspan: "2" } });
          continue;
        }
        tr.createEl("td", { text: formatKg(Math.round((record.weightKg ?? 0) * 1000)) });
        tr.createEl("td", { text: record.reps === null ? "—" : String(record.reps) });
      }
    }
  }

  private renderFinished(root: HTMLElement, start: string): void {
    const workout = this.store.diary.find((w) => w.start === start);
    root.createDiv({ cls: "gym-title", text: t("Workout complete") });
    if (workout?.end) {
      root.createDiv({
        cls: "gym-set",
        text: t("{sets} sets · {minutes} min", { sets: doneSetCount(workout), minutes: minutesBetween(workout.start, workout.end) }),
      });
    }
    if (this.comment?.start !== start) this.comment = { start, text: workout?.comment ?? "" };
    const draft = this.comment;
    const field = root.createEl("textarea", { cls: "gym-comment", attr: { rows: "3", placeholder: t("Comment") } });
    field.value = draft.text;
    field.oninput = () => (draft.text = field.value);
    root.createEl("button", { cls: "gym-primary gym-big", text: "OK" }).onclick = () => this.run(async () => {
      const text = draft.text.trim();
      if (workout && text !== (workout.comment ?? "")) {
        await this.store.updateDiary((diary) => {
          const target = diary.find((w) => w.start === start);
          if (target) target.comment = text || null;
        });
      }
      this.comment = null;
      this.mode = { kind: "choose" };
    });
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      this.message(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      this.busy = false;
    }
    this.render();
  }
}

function exerciseOrdinal(workout: Workout, exercise: string): number {
  const started = [...new Set(workout.records.map((record) => record.exercise))];
  const index = started.indexOf(exercise);
  return index >= 0 ? index + 1 : started.length + 1;
}

function setLabel(step: Step): string {
  return t("Set {n} of {total}", { n: step.setNo, total: step.item.sets }) + t(" · target {reps} reps", { reps: step.item.reps });
}
