import { App, normalizePath, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, TFolder } from "obsidian";
import { currentLanguage, Language, LANGUAGES, setLanguage, structureNames, StructureNames, t } from "./i18n";
import { LogBlock } from "./log";
import { ExerciseNotes } from "./notes";
import { PlanBlock } from "./plan";
import { GymStore, LOG_BLOCK, PLAN_BLOCK } from "./store";
import { GymBlock } from "./view";

interface GymSettings {
  gymFolder: string;
  language: Language;
}

const DEFAULT_SETTINGS: GymSettings = { gymFolder: "", language: "en" };

const NOTES: { key: Exclude<keyof StructureNames, "exercises">; block: string }[] = [
  { key: "workout", block: "gym" },
  { key: "plan", block: PLAN_BLOCK },
  { key: "log", block: LOG_BLOCK },
];

export default class GymPlugin extends Plugin {
  settings: GymSettings = { ...DEFAULT_SETTINGS };
  notes!: ExerciseNotes;
  store!: GymStore;

  async onload(): Promise<void> {
    this.settings = await this.readSettings();
    setLanguage(this.settings.language);
    this.notes = new ExerciseNotes(this.app, () => this.settings.gymFolder);
    this.store = new GymStore(this.app, () => this.root);

    this.registerMarkdownCodeBlockProcessor("gym", (_source, el, ctx) => {
      ctx.addChild(new GymBlock(el, this.app, this.store, this.notes));
    });
    this.registerMarkdownCodeBlockProcessor(PLAN_BLOCK, (_source, el, ctx) => {
      ctx.addChild(new PlanBlock(el, this.app, this.store, this.notes));
    });
    this.registerMarkdownCodeBlockProcessor(LOG_BLOCK, (_source, el, ctx) => {
      ctx.addChild(new LogBlock(el, this.app, this.store, this.notes));
    });
    this.addRibbonIcon("dumbbell", t("Gym: open workout"), () => void this.openWorkout());
    this.addCommand({ id: "open-workout", name: t("Open workout"), callback: () => void this.openWorkout() });
    this.addSettingTab(new GymSettingTab(this.app, this));

    const reloadIfData = (file: TAbstractFile, oldPath?: string) => {
      if (this.store.isDataFile(file) || (oldPath && this.store.isDataFile(oldPath))) void this.store.load();
    };
    this.registerEvent(this.app.vault.on("modify", (file) => reloadIfData(file)));
    this.registerEvent(this.app.vault.on("create", (file) => {
      this.notes.rebuild();
      reloadIfData(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.notes.rebuild();
      reloadIfData(file);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.notes.rebuild();
      reloadIfData(file, oldPath);
      this.followGymFolder(file, oldPath);
      if (file instanceof TFile && this.notes.contains(file.path) && this.notes.contains(oldPath)) {
        const oldName = oldPath.slice(oldPath.lastIndexOf("/") + 1).replace(/\.md$/, "");
        void this.store.renameExercise(oldName, file.basename);
      }
    }));

    this.app.workspace.onLayoutReady(async () => {
      await this.ensureStructure();
      this.notes.rebuild();
      await this.store.load();
    });
  }

  async onExternalSettingsChange(): Promise<void> {
    this.settings = await this.readSettings();
    setLanguage(this.settings.language);
    this.notes.rebuild();
    await this.store.load();
  }

  async readSettings(): Promise<GymSettings> {
    const data = (await this.loadData()) as Partial<GymSettings> | null;
    return {
      gymFolder: data?.gymFolder ?? DEFAULT_SETTINGS.gymFolder,
      language: data?.language && data.language in LANGUAGES ? data.language : DEFAULT_SETTINGS.language,
    };
  }

  async setGymFolder(folder: string): Promise<void> {
    this.settings.gymFolder = folder.trim();
    await this.saveData(this.settings);
    await this.ensureStructure();
    this.notes.rebuild();
    await this.store.load();
  }

  async setPluginLanguage(language: Language): Promise<void> {
    this.settings.language = language;
    await this.saveData(this.settings);
    setLanguage(language);
    await this.ensureStructure();
    this.notes.rebuild();
    await this.store.load();
  }

  private get root(): string | null {
    const folder = this.settings.gymFolder.trim();
    return folder ? normalizePath(folder) : null;
  }

  private followGymFolder(item: TAbstractFile, oldPath: string): void {
    const folder = this.root;
    if (!folder || !(item instanceof TFolder)) return;
    if (oldPath === folder || folder.startsWith(`${oldPath}/`)) {
      void this.setGymFolder(item.path + folder.slice(oldPath.length));
    }
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
      .setDesc(t("Folder with {workout}, {plan}, {log} and {exercises}/. Missing files are created. The plan and the log keep their data as text inside their blocks; every note in {exercises}/ is an exercise.", { ...names }))
      .addText((text) => {
        text.setPlaceholder("Gym").setValue(this.plugin.settings.gymFolder);
        text.inputEl.addEventListener("change", () => void this.plugin.setGymFolder(text.getValue()));
      });
  }
}
