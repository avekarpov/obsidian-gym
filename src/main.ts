import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { LlmExporter } from "./export";
import { LogBlock } from "./log";
import { PlanBlock } from "./plan";
import { openGymDb } from "./schema";
import { GymBlock } from "./view";

const WORKOUT_NOTE = "Зал (Бета)/Тренировка.md";

interface GymSettings {
  llmExportPath: string;
}

const DEFAULT_SETTINGS: GymSettings = { llmExportPath: "" };

export default class GymPlugin extends Plugin {
  settings: GymSettings = { ...DEFAULT_SETTINGS };
  exporter: LlmExporter | null = null;

  async onload(): Promise<void> {
    this.settings = await this.readSettings();
    this.registerMarkdownCodeBlockProcessor("gym", (_source, el, ctx) => {
      ctx.addChild(new GymBlock(el, this.app));
    });
    this.registerMarkdownCodeBlockProcessor("gym-plan", (_source, el, ctx) => {
      ctx.addChild(new PlanBlock(el, this.app));
    });
    this.registerMarkdownCodeBlockProcessor("gym-log", (_source, el, ctx) => {
      ctx.addChild(new LogBlock(el, this.app));
    });
    this.addRibbonIcon("dumbbell", "Gym: open workout", () => void this.openWorkout());
    this.addCommand({ id: "open-workout", name: "Open workout", callback: () => void this.openWorkout() });
    this.addSettingTab(new GymSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => void this.startExporter());
  }

  onunload(): void {
    this.exporter?.cancel();
  }

  async readSettings(): Promise<GymSettings> {
    return { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<GymSettings> | null) };
  }

  async setExportPath(path: string): Promise<void> {
    this.settings.llmExportPath = path.trim();
    await this.saveData(this.settings);
    await this.exporter?.run();
  }

  private async startExporter(): Promise<void> {
    try {
      const db = await openGymDb(this.app);
      const exporter = new LlmExporter(
        this.app.vault.adapter,
        db,
        async () => (await this.readSettings()).llmExportPath,
        this.settings.llmExportPath,
      );
      this.exporter = exporter;
      this.register(db.onChange(() => exporter.schedule()));
      exporter.schedule();
    } catch (error) {
      console.error("gym: LLM export is unavailable", error);
    }
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

class GymSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: GymPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("LLM export path")
      .setDesc("JSON file with the plan and all workouts for a chat bot, e.g. Зал (Бета)/.llm.json. Empty means no export; clearing it deletes the file. Synced to all devices.")
      .addText((text) => {
        text.setPlaceholder("Зал (Бета)/.llm.json").setValue(this.plugin.settings.llmExportPath);
        text.inputEl.addEventListener("change", () => void this.plugin.setExportPath(text.getValue()));
      });
  }
}
