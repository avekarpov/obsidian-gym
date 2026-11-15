import { App, MarkdownRenderChild, Notice } from "obsidian";
import { formatKg } from "./format";
import { LightDb } from "./lightdb";
import { EXERCISE_NOTES_DIR } from "./program";
import { bindWeightDrag, closeScale } from "./scale";
import { openGymDb } from "./schema";
import { Exercise, loadExercises, loadSchemes, Scheme } from "./workout";

interface Draft {
  schemeId: string;
  exerciseId: string;
  name: string;
  perSide: boolean;
  sets: string;
  reps: string;
  weight: { grams: number };
}

interface NewExercise {
  schemeId: string;
  existingId: string;
  name: string;
  perSide: boolean;
  sets: string;
  reps: string;
  weight: { grams: number };
}

export class PlanBlock extends MarkdownRenderChild {
  private db: LightDb | null = null;
  private draft: Draft | null = null;
  private adding: NewExercise | null = null;
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
          if (this.draft?.schemeId === scheme.id && this.draft.exerciseId === id) this.renderEditor(body, db, scheme, exercise, this.draft);
          else this.renderRow(body, scheme, exercise);
        }
        if (this.adding?.schemeId === scheme.id) this.renderAdd(root, db, scheme, exercises, this.adding);
        else {
          root.createEl("button", { cls: "gym-plan-add", text: "Add exercise" }).onclick = () => {
            this.draft = null;
            this.adding = {
              schemeId: scheme.id, existingId: "", name: "", perSide: false,
              sets: "3", reps: "12", weight: { grams: 0 },
            };
            this.render();
          };
        }
      }
    } catch (error) {
      this.error(error);
    }
  }

  private renderRow(body: HTMLElement, scheme: Scheme, exercise: Exercise): void {
    const tr = body.createEl("tr", { cls: "gym-plan-row" });
    tr.onclick = () => {
      this.adding = null;
      this.draft = {
        schemeId: scheme.id,
        exerciseId: exercise.id,
        name: exercise.name,
        perSide: exercise.perSide,
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

  private renderEditor(body: HTMLElement, db: LightDb, scheme: Scheme, exercise: Exercise, draft: Draft): void {
    const cell = body.createEl("tr", { cls: "gym-plan-edit" }).createEl("td", { attr: { colspan: "4" } });
    this.renderName(cell.createDiv({ cls: "gym-plan-edit-name" }), exercise);
    const nameField = cell.createEl("label", { cls: "gym-plan-field" });
    nameField.createSpan({ text: "Name" });
    const name = nameField.createEl("input", { cls: "gym-plan-name", type: "text" });
    name.value = draft.name;
    name.oninput = () => (draft.name = name.value);
    const sideField = cell.createEl("label", { cls: "gym-plan-check" });
    const side = sideField.createEl("input", { type: "checkbox" });
    side.checked = draft.perSide;
    side.onchange = () => {
      draft.perSide = side.checked;
      this.render();
    };
    sideField.createSpan({ text: "Weight per side (dumbbells, one arm or leg)" });
    const fields = cell.createDiv({ cls: "gym-plan-fields" });
    this.planFields(fields, draft, draft.perSide);

    const actions = cell.createDiv({ cls: "gym-plan-actions" });
    const index = scheme.exercises.indexOf(exercise.id);
    const up = actions.createEl("button", { text: "↑" });
    up.disabled = index <= 0;
    up.onclick = () => void this.act(() => this.move(db, scheme, exercise.id, -1));
    const down = actions.createEl("button", { text: "↓" });
    down.disabled = index >= scheme.exercises.length - 1;
    down.onclick = () => void this.act(() => this.move(db, scheme, exercise.id, 1));
    actions.createEl("button", { cls: "mod-warning", text: "Remove from group" }).onclick = () => {
      if (!window.confirm(`Remove "${exercise.name}" from ${scheme.name}? History is kept.`)) return;
      void this.act(async () => {
        await db.delete("scheme_exercises", `${scheme.id}:${exercise.id}`);
        this.draft = null;
      });
    };
    actions.createDiv({ cls: "gym-plan-spacer" });
    actions.createEl("button", { text: "Cancel" }).onclick = () => {
      this.draft = null;
      this.render();
    };
    actions.createEl("button", { cls: "gym-primary", text: "Save" }).onclick = () => {
      const plan = parsePlan(draft);
      if (!plan) return;
      const newName = draft.name.trim();
      if (!newName) {
        new Notice("Gym: enter a name");
        return;
      }
      void this.act(async () => {
        await db.transaction([
          { op: "put", table: "exercises", row: draft.exerciseId, fields: { name: newName, per_side: draft.perSide ? 1 : 0 } },
          { op: "put", table: "plan", row: draft.exerciseId, fields: plan },
        ]);
        this.draft = null;
      });
    };
  }

  private renderAdd(root: HTMLElement, db: LightDb, scheme: Scheme, exercises: Map<string, Exercise>, form: NewExercise): void {
    const box = root.createDiv({ cls: "gym-plan-new" });
    box.createDiv({ cls: "gym-plan-edit-name", text: `Add exercise to ${scheme.name}` });

    const pickField = box.createEl("label", { cls: "gym-plan-field" });
    pickField.createSpan({ text: "Exercise" });
    const pick = pickField.createEl("select", { cls: "dropdown" });
    pick.createEl("option", { text: "New exercise", value: "" });
    const available = [...exercises.values()]
      .filter((e) => !scheme.exercises.includes(e.id))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    for (const e of available) pick.createEl("option", { text: e.name, value: e.id });
    pick.value = form.existingId;
    pick.onchange = () => {
      form.existingId = pick.value;
      this.render();
    };

    if (!form.existingId) {
      const nameField = box.createEl("label", { cls: "gym-plan-field" });
      nameField.createSpan({ text: "Name" });
      const name = nameField.createEl("input", { type: "text", attr: { placeholder: "Подтягивания" } });
      name.value = form.name;
      name.oninput = () => (form.name = name.value);

      const sideField = box.createEl("label", { cls: "gym-plan-check" });
      const side = sideField.createEl("input", { type: "checkbox" });
      side.checked = form.perSide;
      side.onchange = () => {
        form.perSide = side.checked;
        this.render();
      };
      sideField.createSpan({ text: "Weight per side (dumbbells, one arm or leg)" });

      this.planFields(box.createDiv({ cls: "gym-plan-fields" }), form, form.perSide);
    } else {
      const existing = exercises.get(form.existingId);
      if (existing) {
        box.createDiv({
          cls: "gym-muted",
          text: `${existing.sets} × ${existing.reps ?? "—"} · ${existing.weightG === null ? "—" : weightText(existing.weightG, existing)}. Edit the plan after adding.`,
        });
      }
    }

    const actions = box.createDiv({ cls: "gym-plan-actions" });
    actions.createDiv({ cls: "gym-plan-spacer" });
    actions.createEl("button", { text: "Cancel" }).onclick = () => {
      this.adding = null;
      this.render();
    };
    actions.createEl("button", { cls: "gym-primary", text: "Add" }).onclick = () => {
      const position = nextPosition(db, scheme.id);
      if (form.existingId) {
        const exerciseId = form.existingId;
        void this.act(async () => {
          await db.put("scheme_exercises", `${scheme.id}:${exerciseId}`, { scheme_id: scheme.id, exercise_id: exerciseId, position });
          this.adding = null;
        });
        return;
      }
      const name = form.name.trim();
      if (!name) {
        new Notice("Gym: enter a name");
        return;
      }
      const plan = parsePlan(form);
      if (!plan) return;
      const exerciseId = `ex_${crypto.randomUUID().slice(0, 8)}`;
      void this.act(async () => {
        await db.transaction([
          { op: "put", table: "exercises", row: exerciseId, fields: { name, note: null, per_side: form.perSide ? 1 : 0 } },
          { op: "put", table: "plan", row: exerciseId, fields: plan },
          { op: "put", table: "scheme_exercises", row: `${scheme.id}:${exerciseId}`, fields: { scheme_id: scheme.id, exercise_id: exerciseId, position } },
        ]);
        this.adding = null;
      });
    };
  }

  private planFields(fields: HTMLElement, draft: { sets: string; reps: string; weight: { grams: number } }, perSide: boolean): void {
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
    const show = () => value.setText(`${formatKg(draft.weight.grams)} kg${perSide ? " per side" : ""}`);
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
  }

  private async move(db: LightDb, scheme: Scheme, exerciseId: string, shift: number): Promise<void> {
    const order = [...scheme.exercises];
    const from = order.indexOf(exerciseId);
    const to = from + shift;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    const current = new Map(db.all("SELECT exercise_id, position FROM scheme_exercises WHERE scheme_id = ?", [scheme.id])
      .map((r) => [r.exercise_id as string, r.position as number]));
    const ops = order
      .map((id, i) => ({ id, position: i + 1 }))
      .filter(({ id, position }) => current.get(id) !== position)
      .map(({ id, position }) => ({ op: "put" as const, table: "scheme_exercises", row: `${scheme.id}:${id}`, fields: { position } }));
    if (ops.length) await db.transaction(ops);
  }

  private async act(action: () => Promise<void>): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      await action();
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

function parsePlan(draft: { sets: string; reps: string; weight: { grams: number } }): { sets: number; reps: number; weight_g: number } | null {
  const sets = Number(draft.sets);
  const reps = Number(draft.reps);
  if (!Number.isInteger(sets) || sets < 1 || !Number.isInteger(reps) || reps < 1) {
    new Notice("Gym: sets and reps must be whole numbers from 1");
    return null;
  }
  return { sets, reps, weight_g: draft.weight.grams };
}

function nextPosition(db: LightDb, schemeId: string): number {
  const row = db.all("SELECT coalesce(max(position), 0) AS p FROM scheme_exercises WHERE scheme_id = ?", [schemeId])[0];
  return (row.p as number) + 1;
}

function weightText(grams: number, exercise: Exercise): string {
  return `${formatKg(grams)} kg${exercise.perSide ? " per side" : ""}`;
}
