import { App, MarkdownRenderChild } from "obsidian";
import { onLanguageChange, t } from "./i18n";
import { formatKg } from "./format";
import { LightDb } from "./lightdb";
import { ExerciseNotes } from "./notes";
import { bindWeightDrag } from "./scale";
import { openGymDb } from "./schema";
import {
  activeWorkout, buildSteps, doneKeys, Exercise, getWorkout,
  lastAction, loadExercises, loadSchemes, pickStep, previousSets, Scheme, startValues, Step, stepKey, Workout, workSetCount,
} from "./workout";

type Mode = { kind: "idle" } | { kind: "choose" } | { kind: "finished"; workoutId: string };

export class GymBlock extends MarkdownRenderChild {
  private db: LightDb | null = null;
  private exercises = new Map<string, Exercise>();
  private schemes: Scheme[] = [];
  private mode: Mode = { kind: "idle" };
  private weight: { key: string; grams: number; reps: number } | null = null;
  private dragging = false;
  private renderPending = false;
  private busy = false;
  private switching = false;

  constructor(containerEl: HTMLElement, private app: App, private notes: ExerciseNotes) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    this.containerEl.addClass("gym");
    try {
      const db = await openGymDb(this.app);
      this.db = db;
      this.register(db.onChange(() => this.render()));
      this.register(this.notes.onChange(() => this.render()));
      this.register(onLanguageChange(() => this.render()));
      this.render();
    } catch (error) {
      this.message(error instanceof Error ? error.message : String(error));
    }
  }

  private message(text: string): void {
    this.containerEl.empty();
    this.containerEl.createDiv({ cls: "gym-error", text });
  }

  private render(): void {
    const db = this.db;
    if (!db) return;
    if (this.dragging) {
      this.renderPending = true;
      return;
    }
    const root = this.containerEl;
    try {
      this.exercises = loadExercises(db);
      this.notes.decorate(this.exercises);
      this.schemes = loadSchemes(db);
    } catch (error) {
      this.message(error instanceof Error ? error.message : String(error));
      return;
    }
    root.empty();
    const active = activeWorkout(db);
    if (active) return this.renderStep(root, db, active);
    this.switching = false;
    if (this.mode.kind === "finished") return this.renderFinished(root, db, this.mode.workoutId);
    if (this.mode.kind === "choose") return this.renderChoose(root);
    this.renderIdle(root);
  }

  private renderIdle(root: HTMLElement): void {
    const start = root.createEl("button", { cls: "gym-primary gym-big", text: t("Start workout") });
    start.onclick = () => {
      this.mode = { kind: "choose" };
      this.render();
    };
  }

  private renderChoose(root: HTMLElement): void {
    root.createDiv({ cls: "gym-title", text: t("What are we training?") });
    const list = root.createDiv({ cls: "gym-schemes" });
    for (const scheme of this.schemes) {
      list.createEl("button", { cls: "gym-primary gym-big", text: scheme.name }).onclick = () => this.run(async (db) => {
        this.mode = { kind: "idle" };
        await db.put("workouts", crypto.randomUUID(), {
          schemes: scheme.id,
          started_at: new Date().toISOString(),
          finished_at: null,
        });
      });
    }
    root.createEl("button", { text: t("Cancel") }).onclick = () => {
      this.mode = { kind: "idle" };
      this.render();
    };
  }

  private renderStep(root: HTMLElement, db: LightDb, workout: Workout): void {
    const { id: workoutId, startedAt } = workout;
    const steps = buildSteps(this.exercises, this.schemes, workout.schemes);
    const done = doneKeys(db, workoutId);
    const step = pickStep(steps, done, workout.currentExercise);
    if (!step) {
      void this.run((db) => db.put("workouts", workoutId, { finished_at: new Date().toISOString() }));
      return;
    }
    if (this.switching) return this.renderSwitch(root, steps, done, step, workoutId);
    const key = stepKey(step);
    if (this.weight?.key !== key) {
      this.weight = { key, ...startValues(db, workoutId, step.exercise) };
    }
    const weight = this.weight;

    const header = root.createDiv({ cls: "gym-header" });
    header.createSpan({ text: t("{group} · exercise {n} of {total}", { group: step.scheme.name, n: step.exerciseIndex + 1, total: step.exerciseCount }) });
    header.createSpan({ text: t("started {time}", { time: formatTime(startedAt) }) });

    const name = root.createDiv({ cls: "gym-exercise", text: step.exercise.name });
    const note = step.exercise.note;
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

    const doneButton = root.createEl("button", { cls: "gym-primary gym-big", text: t("Done") });
    const record = (toRecord: Step[], skipped: boolean) => this.run(async (db) => {
      const recorded = new Set(toRecord.map(stepKey));
      const finished = steps.every((s) => done.has(stepKey(s)) || recorded.has(stepKey(s)));
      const now = new Date().toISOString();
      await db.transaction([
        ...toRecord.map((s) => ({
          op: "put" as const, table: "sets", row: crypto.randomUUID(), fields: {
            workout_id: workoutId, exercise_id: s.exercise.id, set_no: s.setNo,
            kind: "work", weight_g: weight.grams, reps: skipped ? null : weight.reps, done_at: now, skipped: skipped ? 1 : 0,
          },
        })),
        ...(finished ? [{ op: "put" as const, table: "workouts", row: workoutId, fields: { finished_at: now } }] : []),
      ]);
      if (finished) this.mode = { kind: "finished", workoutId };
    });
    doneButton.onclick = () => record([step], false);

    const skips = root.createDiv({ cls: "gym-skips" });
    skips.createEl("button", { text: t("Skip set") }).onclick = () => record([step], true);
    skips.createEl("button", { text: t("Skip exercise") }).onclick = () => record(
      steps.filter((s) => s.exercise.id === step.exercise.id && !done.has(stepKey(s))),
      true,
    );

    const extra = root.createDiv({ cls: "gym-skips" });
    const undo = extra.createEl("button", { text: t("Undo last set") });
    const last = lastAction(db, workoutId);
    undo.disabled = !last;
    undo.onclick = () => {
      if (!last) return;
      void this.run(async (db) => {
        await db.transaction([
          ...last.setIds.map((id) => ({ op: "delete" as const, table: "sets", row: id })),
          { op: "put" as const, table: "workouts", row: workoutId, fields: { current_exercise: last.exerciseId } },
        ]);
        this.weight = {
          key: `${last.exerciseId}:${last.setNo}`,
          grams: last.grams,
          reps: last.reps ?? this.exercises.get(last.exerciseId)?.reps ?? 10,
        };
      });
    };
    extra.createEl("button", { text: t("Change exercise") }).onclick = () => {
      this.switching = true;
      this.render();
    };

    const next = pickStep(steps, new Set([...done, key]), step.exercise.id);
    if (next) {
      root.createDiv({
        cls: "gym-next",
        text: next.exercise.id === step.exercise.id ? t("Next: set {n}", { n: next.setNo }) : t("Next: {name}", { name: next.exercise.name }),
      });
    }

    this.renderPrevious(root, db, workoutId, step);

    const end = root.createEl("button", { cls: "gym-end", text: t("End workout") });
    end.onclick = () => {
      if (!window.confirm(t("End the workout now?"))) return;
      void this.run(async (db) => {
        this.mode = { kind: "finished", workoutId };
        await db.put("workouts", workoutId, { finished_at: new Date().toISOString() });
      });
    };
  }

  private renderSwitch(root: HTMLElement, steps: Step[], done: Set<string>, current: Step, workoutId: string): void {
    root.createDiv({ cls: "gym-title", text: t("Change exercise") });
    const list = root.createDiv({ cls: "gym-switch-list" });
    const seen = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.exercise.id)) continue;
      seen.add(step.exercise.id);
      const own = steps.filter((s) => s.exercise.id === step.exercise.id);
      const finished = own.filter((s) => done.has(stepKey(s))).length;
      const item = list.createEl("button", { cls: "gym-switch-item" });
      if (step.exercise.id === current.exercise.id) item.addClass("is-current");
      item.createSpan({ text: step.exercise.name });
      item.createSpan({ cls: "gym-switch-progress", text: finished === own.length ? t("done") : `${finished}/${own.length}` });
      item.disabled = finished === own.length;
      item.onclick = () => {
        this.switching = false;
        if (step.exercise.id === current.exercise.id) {
          this.render();
          return;
        }
        void this.run((db) => db.put("workouts", workoutId, { current_exercise: step.exercise.id }));
      };
    }
    root.createEl("button", { text: t("Back") }).onclick = () => {
      this.switching = false;
      this.render();
    };
  }

  private renderPrevious(root: HTMLElement, db: LightDb, workoutId: string, step: Step): void {
    const box = root.createDiv({ cls: "gym-previous" });
    const previous = previousSets(db, step.exercise.id, workoutId);
    if (!previous) {
      box.createDiv({ cls: "gym-previous-title", text: t("No previous workouts with this exercise") });
      return;
    }
    const day = new Date(previous.startedAt).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
    box.createDiv({ cls: "gym-previous-title", text: t("Last time · {date}", { date: day }) });
    const table = box.createEl("table");
    const head = table.createEl("thead").createEl("tr");
    for (const title of ["#", t("kg"), t("reps")]) head.createEl("th", { text: title });
    const body = table.createEl("tbody");
    previous.sets.forEach((set, i) => {
      const tr = body.createEl("tr", { cls: set.skipped ? "gym-previous-skipped" : "" });
      tr.createEl("td", { text: String(i + 1) });
      if (set.skipped) {
        tr.createEl("td", { text: t("skipped"), attr: { colspan: "2" } });
        return;
      }
      tr.createEl("td", { text: formatKg(set.grams) });
      tr.createEl("td", { text: set.reps === null ? "—" : String(set.reps) });
    });
  }

  private renderFinished(root: HTMLElement, db: LightDb, workoutId: string): void {
    const workout = getWorkout(db, workoutId);
    root.createDiv({ cls: "gym-title", text: t("Workout complete") });
    if (workout?.finishedAt) {
      const minutes = Math.round((Date.parse(workout.finishedAt) - Date.parse(workout.startedAt)) / 60000);
      root.createDiv({ cls: "gym-set", text: t("{sets} sets · {minutes} min", { sets: workSetCount(db, workoutId), minutes }) });
    }
    const ok = root.createEl("button", { cls: "gym-primary gym-big", text: "OK" });
    ok.onclick = () => {
      this.mode = { kind: "idle" };
      this.render();
    };
  }

  private async run(action: (db: LightDb) => Promise<unknown>): Promise<void> {
    if (!this.db || this.busy) return;
    this.busy = true;
    try {
      await action(this.db);
    } catch (error) {
      this.message(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      this.busy = false;
    }
    this.render();
  }
}

function setLabel(step: Step): string {
  const reps = step.exercise.reps === null ? "" : t(" · target {reps} reps", { reps: step.exercise.reps });
  return t("Set {n} of {total}", { n: step.setNo, total: step.exercise.sets }) + reps;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
