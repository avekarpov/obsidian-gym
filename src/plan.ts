import { App, MarkdownRenderChild } from "obsidian";
import { formatKg, formatSets } from "./format";
import { LightDb } from "./lightdb";
import { EXERCISE_NOTES_DIR } from "./program";
import { openGymDb } from "./schema";
import { lastWorkWeightG, loadExercises, loadSchemes } from "./workout";

export class PlanBlock extends MarkdownRenderChild {
  constructor(containerEl: HTMLElement, private app: App) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    this.containerEl.addClass("gym-plan");
    try {
      const db = await openGymDb(this.app);
      this.register(db.onChange(() => this.render(db)));
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
    const root = this.containerEl;
    try {
      const exercises = loadExercises(db);
      const schemes = loadSchemes(db);
      root.empty();
      for (const scheme of schemes) {
        root.createEl("h2", { text: scheme.name });
        const table = root.createEl("table");
        const head = table.createEl("thead").createEl("tr");
        for (const title of ["Exercise", "Sets × reps", "Weight"]) head.createEl("th", { text: title });
        const body = table.createEl("tbody");
        for (const id of scheme.exercises) {
          const exercise = exercises.get(id);
          if (!exercise) continue;
          const tr = body.createEl("tr");
          const name = tr.createEl("td");
          if (exercise.note) {
            const target = `${EXERCISE_NOTES_DIR}/${exercise.note}`;
            const link = name.createEl("a", { cls: "internal-link", text: exercise.name, attr: { "data-href": target, href: target } });
            link.onclick = (event) => {
              event.preventDefault();
              void this.app.workspace.openLinkText(target, "", false);
            };
          } else {
            name.setText(exercise.name);
          }
          tr.createEl("td", { text: formatSets(exercise) });
          const weight = lastWorkWeightG(db, exercise);
          tr.createEl("td", {
            cls: "gym-plan-weight",
            text: weight === null ? "—" : `${formatKg(weight)} kg${exercise.perSide ? " per side" : ""}`,
          });
        }
      }
    } catch (error) {
      this.error(error);
    }
  }
}
