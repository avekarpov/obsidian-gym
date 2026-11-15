import { Notice, Plugin, TFile } from "obsidian";
import { GymBlock } from "./view";

const WORKOUT_NOTE = "Зал (Бета)/Тренировка.md";

export default class GymPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerMarkdownCodeBlockProcessor("gym", (_source, el, ctx) => {
      ctx.addChild(new GymBlock(el, this.app));
    });
    this.addRibbonIcon("dumbbell", "Gym: open workout", () => void this.openWorkout());
    this.addCommand({ id: "open-workout", name: "Open workout", callback: () => void this.openWorkout() });
  }

  private async openWorkout(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(WORKOUT_NOTE);
    if (!(file instanceof TFile)) {
      new Notice(`Gym: note ${WORKOUT_NOTE} not found`);
      return;
    }
    await this.app.workspace.getLeaf(false).openFile(file, { state: { mode: "preview" } });
  }
}
