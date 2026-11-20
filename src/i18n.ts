export type Language = "en" | "ru";

export const LANGUAGES: Record<Language, string> = { en: "English", ru: "Русский" };

export interface StructureNames {
  workout: string;
  plan: string;
  log: string;
  exercises: string;
}

export const STRUCTURE_NAMES: Record<Language, StructureNames> = {
  en: { workout: "Workout.md", plan: "Plan.md", log: "Log.md", exercises: "Exercises" },
  ru: { workout: "Тренировка.md", plan: "План.md", log: "Дневник.md", exercises: "Упражнения" },
};

const RU: Record<string, string> = {
  "Start workout": "Начать тренировку",
  "What are we training?": "Что тренируем?",
  "Cancel": "Отмена",
  "{group} · exercise {n} of {total}": "{group} · упражнение {n} из {total}",
  "started {time}": "начало {time}",
  "kg": "кг",
  "reps": "повт.",
  "Done": "Готово",
  "Skip set": "Пропустить подход",
  "Skip exercise": "Пропустить упражнение",
  "Undo last set": "Отменить подход",
  "Change exercise": "Сменить упражнение",
  "End workout": "Завершить тренировку",
  "End the workout now?": "Завершить тренировку сейчас?",
  "Back": "Назад",
  "Workout complete": "Тренировка завершена",
  "{sets} sets · {minutes} min": "{sets} подх. · {minutes} мин",
  "Next: set {n}": "Далее: подход {n}",
  "Next: {name}": "Далее: {name}",
  "Set {n} of {total}": "Подход {n} из {total}",
  " · target {reps} reps": " · цель {reps} повт.",
  "done": "готово",
  "No previous workouts with this exercise": "Это упражнение ещё не выполнялось",
  "Last time · {date}": "В прошлый раз · {date}",
  "skipped": "пропущен",
  "Progress": "Прогресс",
  "Workouts": "Тренировки",
  "No workouts yet": "Тренировок пока нет",
  "Other": "Другое",
  "Exercise": "Упражнение",
  "Trend": "Динамика",
  "Last": "Последний",
  "Change": "Изменение",
  "{kg} kg": "{kg} кг",
  "{minutes} min": "{minutes} мин",
  "in progress": "идёт",
  "Delete workout": "Удалить тренировку",
  "Delete": "Удалить",
  "Delete workout {title}? Its sets are deleted too.": "Удалить тренировку {title}? Её подходы тоже удалятся.",
  "No sets": "Нет подходов",
  "Sets": "Подходы",
  "Reps": "Повторы",
  "Add exercise": "Добавить упражнение",
  "Add workout": "Добавить тренировку",
  "Comment": "Комментарий",
  "Recent workouts": "Последние тренировки",
  "How many finished workouts to show on the workout choice screen. 0 hides the table.": "Сколько завершённых тренировок показывать на экране выбора тренировки. 0 — таблица скрыта.",
  "Date": "Дата",
  "Workout": "Тренировка",
  "Open in reading view": "Открывать в режиме чтения",
  "Open {workout}, {plan} and {log} in reading view. You can still switch to editing.": "Открывать {workout}, {plan} и {log} в режиме чтения. Переключиться в редактирование по-прежнему можно.",
  "Invalid data: {error}": "Ошибка в данных: {error}",
  "Fix the JSON in {path} first: {error}": "Сначала исправьте JSON в {path}: {error}",
  "Gym: a workout with this name already exists": "Gym: тренировка с таким названием уже есть",
  "Group \"{group}\" is not in the plan": "Группы «{group}» нет в плане",
  "Gym: finish the workout in progress first": "Gym: сначала завершите начатую тренировку",
  "Delete workout \"{name}\"? Exercises and past workouts are kept.": "Удалить тренировку «{name}»? Упражнения и прошлые тренировки сохранятся.",
  "Add exercise to {group}": "Добавить упражнение в «{group}»",
  "New exercise": "Новое упражнение",
  "Name": "Название",
  "Pull-ups": "Подтягивания",
  "Add": "Добавить",
  "Save": "Сохранить",
  "Remove from group": "Убрать из группы",
  "Remove \"{name}\" from {group}? History is kept.": "Убрать «{name}» из группы «{group}»? История сохранится.",
  "Gym: enter a name": "Gym: введите название",
  "Gym: sets and reps must be whole numbers from 1": "Gym: подходы и повторы — целые числа от 1",
  "{path} not found": "{path} не найден",
  "{path} already exists": "{path} уже существует",
  "Exercise name is empty": "Пустое название упражнения",
  "Set the Gym folder in settings first": "Сначала укажите папку Gym в настройках",
  "Gym: set the Gym folder in settings": "Gym: укажите папку Gym в настройках",
  "Open workout": "Открыть тренировку",
  "Gym: open workout": "Gym: открыть тренировку",
  "Language": "Язык",
  "Interface language and names of the files the plugin creates. Changing it renames them.": "Язык интерфейса и имён файлов, которые создаёт плагин. При смене файлы переименовываются.",
  "Gym folder": "Папка Gym",
  "Folder with {workout}, {plan}, {log} and {exercises}/. Missing files are created. The plan and the log keep their data as text inside their blocks; every note in {exercises}/ is an exercise.": "Папка с {workout}, {plan}, {log} и {exercises}/. Недостающие файлы создаются. План и дневник хранят данные текстом внутри своих блоков; каждая заметка в {exercises}/ — упражнение.",
};

let language: Language = "en";
const listeners = new Set<() => void>();

export function setLanguage(next: Language): void {
  if (next === language) return;
  language = next;
  for (const listener of listeners) listener();
}

export function currentLanguage(): Language {
  return language;
}

const LOCALES: Record<Language, string> = { en: "en-GB", ru: "ru-RU" };

export function locale(): string {
  return LOCALES[language];
}

export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function structureNames(lang: Language = language): StructureNames {
  return STRUCTURE_NAMES[lang];
}

export function t(text: string, params: Record<string, string | number> = {}): string {
  const template = language === "ru" ? RU[text] ?? text : text;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}
