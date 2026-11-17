import { App, normalizePath, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { LlmExporter } from "./export";
import { lightDbApi } from "./lightdb";
import { LogBlock } from "./log";
import { EXERCISES_FOLDER, ExerciseNotes } from "./notes";
import { PlanBlock } from "./plan";
import { openGymDb } from "./schema";
import { GymBlock } from "./view";

interface GymSettings {
  gymFolder: string;
  llmExport: boolean;
}

const DEFAULT_SETTINGS: GymSettings = { gymFolder: "", llmExport: false };
const LLM_EXPORT_FILE = ".llm.json";
const LIGHTDB_WAIT_MS = 1000;
const LIGHTDB_WAIT_ATTEMPTS = 30;

const STRUCTURE: { name: string; block: string }[] = [
  { name: "Workout.md", block: "gym" },
  { name: "Plan.md", block: "gym-plan" },
  { name: "Log.md", block: "gym-log" },
];

export default class GymPlugin extends Plugin {
  settings: GymSettings = { ...DEFAULT_SETTINGS };
  exporter: LlmExporter | null = null;
  notes!: ExerciseNotes;
  private exporterStart: Promise<LlmExporter | null> | null = null;

  async onload(): Promise<void> {
    this.settings = await this.readSettings();
    this.notes = new ExerciseNotes(this.app, () => this.settings.gymFolder);

    this.registerMarkdownCodeBlockProcessor("gym", (_source, el, ctx) => {
      ctx.addChild(new GymBlock(el, this.app, this.notes));
    });
    this.registerMarkdownCodeBlockProcessor("gym-plan", (_source, el, ctx) => {
      ctx.addChild(new PlanBlock(el, this.app, this.notes));
    });
    this.registerMarkdownCodeBlockProcessor("gym-log", (_source, el, ctx) => {
      ctx.addChild(new LogBlock(el, this.app, this.notes));
    });
    this.addRibbonIcon("dumbbell", "Gym: open workout", () => void this.openWorkout());
    this.addCommand({ id: "open-workout", name: "Open workout", callback: () => void this.openWorkout() });
    this.addSettingTab(new GymSettingTab(this.app, this));

    const refreshNotes = () => this.notes.rebuild();
    this.registerEvent(this.app.vault.on("create", refreshNotes));
    this.registerEvent(this.app.vault.on("delete", refreshNotes));
    this.registerEvent(this.app.vault.on("rename", refreshNotes));
    this.registerEvent(this.app.metadataCache.on("changed", refreshNotes));
    this.registerEvent(this.app.metadataCache.on("resolved", refreshNotes));

    this.app.workspace.onLayoutReady(() => {
      this.notes.rebuild();
      void this.ensureStructure();
      void this.ensureExporter();
    });
  }

  onunload(): void {
    this.exporter?.cancel();
  }

  async readSettings(): Promise<GymSettings> {
    const data = (await this.loadData()) as Partial<GymSettings> | null;
    return { gymFolder: data?.gymFolder ?? DEFAULT_SETTINGS.gymFolder, llmExport: data?.llmExport ?? DEFAULT_SETTINGS.llmExport };
  }

  private exportPath(settings: GymSettings): string {
    const folder = settings.gymFolder.trim();
    return settings.llmExport && folder ? normalizePath(`${folder}/${LLM_EXPORT_FILE}`) : "";
  }

  async setGymFolder(folder: string): Promise<void> {
    this.settings.gymFolder = folder.trim();
    await this.saveData(this.settings);
    await this.ensureStructure();
    this.notes.rebuild();
    await this.exporter?.run();
  }

  async setLlmExport(enabled: boolean): Promise<void> {
    this.settings.llmExport = enabled;
    await this.saveData(this.settings);
    const exporter = await this.ensureExporter();
    if (exporter) await exporter.run();
    else new Notice("Gym: LightDB is not available, LLM export is off");
  }

  private get root(): string | null {
    const folder = this.settings.gymFolder.trim();
    return folder ? normalizePath(folder) : null;
  }

  private async ensureStructure(): Promise<void> {
    const root = this.root;
    if (!root) return;
    try {
      const vault = this.app.vault;
      for (const folder of [root, `${root}/${EXERCISES_FOLDER}`]) {
        if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
      }
      for (const { name, block } of STRUCTURE) {
        const path = `${root}/${name}`;
        if (!vault.getAbstractFileByPath(path)) await vault.create(path, "```" + block + "\n```\n");
      }
    } catch (error) {
      new Notice(`Gym: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private ensureExporter(): Promise<LlmExporter | null> {
    if (this.exporter) return Promise.resolve(this.exporter);
    this.exporterStart ??= this.startExporter().finally(() => (this.exporterStart = null));
    return this.exporterStart;
  }

  private async startExporter(): Promise<LlmExporter | null> {
    try {
      for (let attempt = 0; !lightDbApi(this.app); attempt++) {
        if (attempt >= LIGHTDB_WAIT_ATTEMPTS) throw new Error("LightDB plugin is not loaded");
        await new Promise((resolve) => window.setTimeout(resolve, LIGHTDB_WAIT_MS));
      }
      const db = await openGymDb(this.app);
      const exporter = new LlmExporter(
        this.app.vault.adapter,
        db,
        this.notes,
        async () => this.exportPath(await this.readSettings()),
        this.exportPath(this.settings),
      );
      this.exporter = exporter;
      this.register(db.onChange(() => exporter.schedule()));
      this.register(this.notes.onChange(() => exporter.schedule()));
      exporter.schedule();
      return exporter;
    } catch (error) {
      console.error("gym: LLM export is unavailable", error);
      return null;
    }
  }

  private async openWorkout(): Promise<void> {
    const root = this.root;
    if (!root) {
      new Notice("Gym: set the Gym folder in settings");
      return;
    }
    const path = `${root}/${STRUCTURE[0].name}`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Gym: ${path} not found`);
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
      .setName("Gym folder")
      .setDesc(`Folder with Workout.md, Plan.md, Log.md and ${EXERCISES_FOLDER}/. Missing files are created. Every note in ${EXERCISES_FOLDER}/ is an exercise; do not edit its gym-id property.`)
      .addText((text) => {
        text.setPlaceholder("Gym").setValue(this.plugin.settings.gymFolder);
        text.inputEl.addEventListener("change", () => void this.plugin.setGymFolder(text.getValue()));
      });
    new Setting(containerEl)
      .setName("LLM export")
      .setDesc(`Keep ${LLM_EXPORT_FILE} with the plan and all workouts in the Gym folder for a chat bot. Turning it off deletes the file. Synced to all devices.`)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.llmExport).onChange((value) => void this.plugin.setLlmExport(value)),
      );
  }
}
