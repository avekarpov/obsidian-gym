import { App, normalizePath, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";
import { LlmExporter } from "./export";
import { lightDbApi } from "./lightdb";
import { PlanLinks } from "./links";
import { LogBlock } from "./log";
import { currentLanguage, Language, LANGUAGES, setLanguage, structureNames, StructureNames, t } from "./i18n";
import { ExerciseNotes } from "./notes";
import { PlanBlock } from "./plan";
import { openGymDb } from "./schema";
import { GymBlock } from "./view";

interface GymSettings {
  gymFolder: string;
  useLlm: boolean;
  language: Language;
}

const DEFAULT_SETTINGS: GymSettings = { gymFolder: "", useLlm: false, language: "en" };
const LLM_FOLDER = ".llm";
const LIGHTDB_WAIT_MS = 1000;
const LIGHTDB_WAIT_ATTEMPTS = 30;

const NOTES: { key: Exclude<keyof StructureNames, "exercises">; block: string }[] = [
  { key: "workout", block: "gym" },
  { key: "plan", block: "gym-plan" },
  { key: "log", block: "gym-log" },
];

export default class GymPlugin extends Plugin {
  settings: GymSettings = { ...DEFAULT_SETTINGS };
  exporter: LlmExporter | null = null;
  planLinks: PlanLinks | null = null;
  notes!: ExerciseNotes;
  private exporterStart: Promise<LlmExporter | null> | null = null;

  async onload(): Promise<void> {
    this.settings = await this.readSettings();
    setLanguage(this.settings.language);
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
    this.addRibbonIcon("dumbbell", t("Gym: open workout"), () => void this.openWorkout());
    this.addCommand({ id: "open-workout", name: t("Open workout"), callback: () => void this.openWorkout() });
    this.addSettingTab(new GymSettingTab(this.app, this));

    const refreshNotes = () => {
      this.notes.rebuild();
      void this.notes.assignMissingIds();
    };
    this.registerEvent(this.app.vault.on("create", refreshNotes));
    this.registerEvent(this.app.vault.on("delete", refreshNotes));
    this.registerEvent(this.app.vault.on("rename", refreshNotes));
    this.registerEvent(this.app.vault.on("rename", (item, oldPath) => {
      const folder = this.root;
      if (!folder || !(item instanceof TFolder)) return;
      if (oldPath === folder || folder.startsWith(`${oldPath}/`)) {
        void this.setGymFolder(item.path + folder.slice(oldPath.length));
      }
    }));
    this.registerEvent(this.app.metadataCache.on("changed", refreshNotes));
    this.registerEvent(this.app.metadataCache.on("resolved", refreshNotes));

    this.app.workspace.onLayoutReady(() => {
      refreshNotes();
      void this.ensureStructure();
      void this.ensureExporter();
    });
  }

  async onExternalSettingsChange(): Promise<void> {
    this.settings = await this.readSettings();
    setLanguage(this.settings.language);
    this.notes.rebuild();
    void this.notes.assignMissingIds();
    this.exporter?.schedule();
    this.planLinks?.schedule();
  }

  onunload(): void {
    this.exporter?.cancel();
    this.planLinks?.cancel();
  }

  async readSettings(): Promise<GymSettings> {
    const data = (await this.loadData()) as Partial<GymSettings> | null;
    return {
      gymFolder: data?.gymFolder ?? DEFAULT_SETTINGS.gymFolder,
      useLlm: data?.useLlm ?? DEFAULT_SETTINGS.useLlm,
      language: data?.language && data.language in LANGUAGES ? data.language : DEFAULT_SETTINGS.language,
    };
  }

  private llmDir(settings: GymSettings): string {
    const folder = settings.gymFolder.trim();
    return settings.useLlm && folder ? normalizePath(`${folder}/${LLM_FOLDER}`) : "";
  }

  async setGymFolder(folder: string): Promise<void> {
    this.settings.gymFolder = folder.trim();
    await this.saveData(this.settings);
    await this.ensureStructure();
    this.notes.rebuild();
    await this.notes.assignMissingIds();
    await this.exporter?.run();
    this.planLinks?.schedule();
  }

  async setPluginLanguage(language: Language): Promise<void> {
    this.settings.language = language;
    await this.saveData(this.settings);
    setLanguage(language);
    await this.ensureStructure();
    this.notes.rebuild();
    await this.notes.assignMissingIds();
    this.planLinks?.schedule();
  }

  async setUseLlm(enabled: boolean): Promise<void> {
    this.settings.useLlm = enabled;
    await this.saveData(this.settings);
    const exporter = await this.ensureExporter();
    if (exporter) await exporter.run();
    else new Notice(t("Gym: LightDB is not available, LLM export is off"));
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
      if (!vault.getAbstractFileByPath(root)) await vault.createFolder(root);
      const names = structureNames();
      const others = (Object.keys(LANGUAGES) as Language[])
        .filter((lang) => lang !== currentLanguage())
        .map((lang) => structureNames(lang));
      const place = async (key: keyof StructureNames, create: (path: string) => Promise<unknown>) => {
        const path = `${root}/${names[key]}`;
        if (vault.getAbstractFileByPath(path)) return;
        const old = others.map((other) => vault.getAbstractFileByPath(`${root}/${other[key]}`)).find((item) => item);
        if (old) await this.app.fileManager.renameFile(old, path);
        else await create(path);
      };
      await place("exercises", (path) => vault.createFolder(path));
      for (const { key, block } of NOTES) {
        await place(key, (path) => vault.create(path, "```" + block + "\n```\n"));
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
        async () => this.llmDir(await this.readSettings()),
        this.llmDir(this.settings),
      );
      this.exporter = exporter;
      this.register(db.onChange(() => exporter.schedule()));
      this.register(this.notes.onChange(() => exporter.schedule()));
      exporter.schedule();

      const planLinks = new PlanLinks(this.app, db, this.notes, () => {
        const root = this.root;
        return root ? `${root}/${structureNames().plan}` : null;
      });
      this.planLinks = planLinks;
      this.register(db.onChange(() => planLinks.schedule()));
      this.register(this.notes.onChange(() => planLinks.schedule()));
      planLinks.schedule();
      return exporter;
    } catch (error) {
      console.error("gym: LLM export is unavailable", error);
      return null;
    }
  }

  private async openWorkout(): Promise<void> {
    const root = this.root;
    if (!root) {
      new Notice(t("Gym: set the Gym folder in settings"));
      return;
    }
    const path = `${root}/${structureNames().workout}`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Gym: ${t("{path} not found", { path })}`);
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
      .setName(t("Language"))
      .setDesc(t("Interface language and names of the files the plugin creates. Changing it renames them."))
      .addDropdown((dropdown) => {
        for (const [code, label] of Object.entries(LANGUAGES)) dropdown.addOption(code, label);
        dropdown.setValue(this.plugin.settings.language).onChange(async (value) => {
          await this.plugin.setPluginLanguage(value as Language);
          this.display();
        });
      });
    const names = structureNames();
    new Setting(containerEl)
      .setName(t("Gym folder"))
      .setDesc(t("Folder with {workout}, {plan}, {log} and {exercises}/. Missing files are created. Every note in {exercises}/ is an exercise; do not edit its gym-id property.", { ...names }))
      .addText((text) => {
        text.setPlaceholder("Gym").setValue(this.plugin.settings.gymFolder);
        text.inputEl.addEventListener("change", () => void this.plugin.setGymFolder(text.getValue()));
      });
    new Setting(containerEl)
      .setName(t("Use LLM"))
      .setDesc(t("Keep a hidden {folder}/ folder in the Gym folder with the plan and all workouts as JSON and a README describing the format, for a chat bot. Turning it off deletes the folder. Synced to all devices.", { folder: LLM_FOLDER }))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useLlm).onChange((value) => void this.plugin.setUseLlm(value)),
      );
  }
}
