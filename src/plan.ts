import { App, MarkdownRenderChild, Notice } from "obsidian";
import { formatKg } from "./format";
import { LightDb } from "./lightdb";
import { EXERCISE_NOTES_DIR } from "./program";
import { bindWeightDrag, closeScale } from "./scale";
import { openGymDb } from "./schema";
import { Exercise, loadExercises, loadSchemes } from "./workout";

interface Draft {
  exerciseId: string;
  sets: string;
  reps: string;
  weight: { grams: number };
}

export class PlanBlock extends MarkdownRenderChild {
  private db: LightDb | null = null;
  private draft: Draft | null = null;
  private dragging = false;
  private renderPending = false;
  private saving = false;

  constructor(containerEl: HTMLElement, private app: App) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    this.containerEl.addClass("gym-plan");
    this.register(closeScale);
    try {
      const db = await openGymDb(this.app);
      this.db = db;
      this.register(db.onChange(() => this.render()));
      this.render();
    } catch (error) {
      this.error(error);
    }
  }

  private error(error: unknown): void {
    this.containerEl.empty();
    this.containerEl.createDiv({ cls: "gym-error", text: error instanceof Error ? error.message : String(error) });
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
      const exercises = loadExercises(db);
      const schemes = loadSchemes(db);
      root.empty();
      for (const scheme of schemes) {
        root.createEl("h2", { text: scheme.name });
        const table = root.createEl("table");
        const head = table.createEl("thead").createEl("tr");
        for (const title of ["Exercise", "Sets", "Reps", "Weight"]) head.createEl("th", { text: title });
        const body = table.createEl("tbody");
        for (const id of scheme.exercises) {
          const exercise = exercises.get(id);
          if (!exercise) continue;
          if (this.draft?.exerciseId === id) this.renderEditor(body, db, exercise, this.draft);
          else this.renderRow(body, exercise);
        }
      }
    } catch (error) {
      this.error(error);
    }
  }

  private renderRow(body: HTMLElement, exercise: Exercise): void {
    const tr = body.createEl("tr", { cls: "gym-plan-row" });
    tr.onclick = () => {
      this.draft = {
        exerciseId: exercise.id,
        sets: String(exercise.sets),
        reps: exercise.reps === null ? "" : String(exercise.reps),
        weight: { grams: exercise.weightG ?? 0 },
      };
      this.render();
    };
    this.renderName(tr.createEl("td"), exercise);
    tr.createEl("td", { cls: "gym-num", text: String(exercise.sets) });
    tr.createEl("td", { cls: "gym-num", text: exercise.reps === null ? "—" : String(exercise.reps) });
    tr.createEl("td", { cls: "gym-num", text: exercise.weightG === null ? "—" : weightText(exercise.weightG, exercise) });
  }

  private renderEditor(body: HTMLElement, db: LightDb, exercise: Exercise, draft: Draft): void {
    const cell = body.createEl("tr", { cls: "gym-plan-edit" }).createEl("td", { attr: { colspan: "4" } });
    this.renderName(cell.createDiv({ cls: "gym-plan-edit-name" }), exercise);
    const fields = cell.createDiv({ cls: "gym-plan-fields" });

    const number = (label: string, value: string, set: (v: string) => void) => {
      const field = fields.createEl("label", { cls: "gym-plan-field" });
      field.createSpan({ text: label });
      const input = field.createEl("input", { type: "number", attr: { min: "1", step: "1", inputmode: "numeric" } });
      input.value = value;
      input.oninput = () => set(input.value);
    };
    number("Sets", draft.sets, (v) => (draft.sets = v));
    number("Reps", draft.reps, (v) => (draft.reps = v));

    const field = fields.createDiv({ cls: "gym-plan-field" });
    field.createSpan({ text: "Weight" });
    const value = field.createDiv({ cls: "gym-plan-weight" });
    const show = () => value.setText(weightText(draft.weight.grams, exercise));
    show();
    bindWeightDrag(value, draft.weight, show, {
      onStart: () => (this.dragging = true),
      onEnd: () => {
        this.dragging = false;
        if (this.renderPending) {
          this.renderPending = false;
          this.render();
        }
      },
    });

    const actions = cell.createDiv({ cls: "gym-plan-actions" });
    actions.createEl("button", { text: "Cancel" }).onclick = () => {
      this.draft = null;
      this.render();
    };
    actions.createEl("button", { cls: "gym-primary", text: "Save" }).onclick = () => void this.save(db, draft);
  }

  private async save(db: LightDb, draft: Draft): Promise<void> {
    if (this.saving) return;
    const sets = Number(draft.sets);
    const reps = Number(draft.reps);
    if (!Number.isInteger(sets) || sets < 1 || !Number.isInteger(reps) || reps < 1) {
      new Notice("Gym: sets and reps must be whole numbers from 1");
      return;
    }
    this.saving = true;
    try {
      await db.put("plan", draft.exerciseId, { sets, reps, weight_g: draft.weight.grams });
      this.draft = null;
      this.render();
    } catch (error) {
      new Notice(`Gym: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.saving = false;
    }
  }

  private renderName(el: HTMLElement, exercise: Exercise): void {
    if (!exercise.note) {
      el.setText(exercise.name);
      return;
    }
    const target = `${EXERCISE_NOTES_DIR}/${exercise.note}`;
    const link = el.createEl("a", { cls: "internal-link", text: exercise.name, attr: { "data-href": target, href: target } });
    link.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.app.workspace.openLinkText(target, "", false);
    };
  }
}

function weightText(grams: number, exercise: Exercise): string {
  return `${formatKg(grams)} kg${exercise.perSide ? " per side" : ""}`;
}
