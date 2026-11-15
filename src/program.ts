export interface ExerciseSeed {
  id: string;
  name: string;
  note: string;
  perSide: boolean;
  warmupSets: number;
  workSets: number;
  repsMin: number;
  repsMax: number;
  startWeightKg: number | null;
}

export const EXERCISES: ExerciseSeed[] = [
  { id: "chest_press_machine", name: "Жим в тренажёре сидя", note: "Жим в тренажёре сидя", perSide: false, warmupSets: 1, workSets: 3, repsMin: 8, repsMax: 12, startWeightKg: 40 },
  { id: "incline_db_press", name: "Жим гантелей на наклонной скамье (30°)", note: "Жим гантелей на наклонной скамье (30°) (на руку)", perSide: true, warmupSets: 0, workSets: 3, repsMin: 8, repsMax: 12, startWeightKg: 16 },
  { id: "cable_crossover", name: "Сведение рук в кроссовере на уровне груди", note: "Сведение рук в кроссовере на уровне груди (на руку)", perSide: true, warmupSets: 0, workSets: 3, repsMin: 12, repsMax: 15, startWeightKg: 12 },
  { id: "lateral_raise", name: "Махи гантелями в стороны", note: "Махи гантелями в стороны (на руку)", perSide: true, warmupSets: 0, workSets: 3, repsMin: 12, repsMax: 15, startWeightKg: 8 },
  { id: "overhead_rope_extension", name: "Разгибание рук с канатом из-за головы на блоке", note: "Разгибание рук с канатом из-за головы на блоке", perSide: false, warmupSets: 0, workSets: 3, repsMin: 10, repsMax: 15, startWeightKg: 15 },
  { id: "straight_bar_pushdown", name: "Разгибание рук вниз на блоке с прямой рукоятью", note: "Разгибание рук вниз на блоке с прямой рукоятью", perSide: false, warmupSets: 0, workSets: 3, repsMin: 12, repsMax: 15, startWeightKg: 15 },
  { id: "lat_pulldown", name: "Вертикальная тяга, длинная прямая рукоять, хват сверху шире плеч", note: "Вертикальная тяга, длинная прямая рукоять, хват сверху шире плеч", perSide: false, warmupSets: 1, workSets: 3, repsMin: 10, repsMax: 12, startWeightKg: null },
  { id: "t_bar_row", name: "Тяга Т-грифа с упором грудью, нейтральный хват", note: "Тяга Т-грифа с упором грудью, нейтральный хват", perSide: false, warmupSets: 1, workSets: 3, repsMin: 10, repsMax: 15, startWeightKg: null },
  { id: "hyperextension", name: "Гиперэкстензия", note: "Гиперэкстензия", perSide: false, warmupSets: 0, workSets: 3, repsMin: 10, repsMax: 15, startWeightKg: null },
  { id: "reverse_fly_machine", name: "Обратная бабочка в тренажёре", note: "Обратная бабочка в тренажёре", perSide: false, warmupSets: 0, workSets: 3, repsMin: 12, repsMax: 15, startWeightKg: null },
  { id: "seated_db_curl", name: "Одновременные сгибания рук с гантелями сидя, с супинацией", note: "Одновременные сгибания рук с гантелями сидя, с супинацией (на руку)", perSide: true, warmupSets: 0, workSets: 3, repsMin: 10, repsMax: 12, startWeightKg: null },
  { id: "machine_curl", name: "Сгибание рук в тренажёре на бицепс", note: "Сгибание рук в тренажёре на бицепс", perSide: false, warmupSets: 1, workSets: 3, repsMin: 10, repsMax: 15, startWeightKg: null },
  { id: "one_arm_db_row", name: "Тяга гантели одной рукой в упоре", note: "Тяга гантели одной рукой в упоре (на руку)", perSide: true, warmupSets: 0, workSets: 3, repsMin: 10, repsMax: 10, startWeightKg: null },
  { id: "low_cable_curl", name: "Сгибание рук на нижнем блоке с прямой рукоятью", note: "Сгибание рук на нижнем блоке с прямой рукоятью", perSide: false, warmupSets: 0, workSets: 3, repsMin: 12, repsMax: 15, startWeightKg: null },
  { id: "leg_press", name: "Жим ногами", note: "Жим ногами", perSide: false, warmupSets: 0, workSets: 3, repsMin: 8, repsMax: 12, startWeightKg: 120 },
  { id: "smith_squat", name: "Присед в Смите", note: "Присед в Смите", perSide: false, warmupSets: 0, workSets: 3, repsMin: 8, repsMax: 12, startWeightKg: 37 },
  { id: "seated_leg_curl", name: "Сгибание ног сидя в тренажёре", note: "Сгибание ног сидя в тренажёре", perSide: false, warmupSets: 0, workSets: 3, repsMin: 10, repsMax: 15, startWeightKg: 44 },
  { id: "leg_extension", name: "Разгибание ног в тренажёре", note: "Разгибание ног в тренажёре", perSide: false, warmupSets: 0, workSets: 2, repsMin: 10, repsMax: 15, startWeightKg: 44 },
  { id: "calf_raise", name: "Подъёмы на носки", note: "Подъёмы на носки", perSide: false, warmupSets: 0, workSets: 3, repsMin: 10, repsMax: 15, startWeightKg: 42 },
  { id: "glute_kickback_machine", name: "Отведение ноги назад в тренажёре", note: "Отведение ноги назад в тренажёре (на ногу)", perSide: true, warmupSets: 0, workSets: 3, repsMin: 12, repsMax: 15, startWeightKg: null },
  { id: "bulgarian_split_squat", name: "Болгарские выпады", note: "Болгарские выпады (на ногу)", perSide: true, warmupSets: 0, workSets: 2, repsMin: 8, repsMax: 10, startWeightKg: null },
];

export const SCHEME_SEED: { id: string; name: string; exercises: string[] }[] = [
  {
    id: "chest",
    name: "Грудь + трицепс",
    exercises: ["chest_press_machine", "incline_db_press", "cable_crossover", "lateral_raise", "overhead_rope_extension", "straight_bar_pushdown"],
  },
  {
    id: "back",
    name: "Спина + бицепс",
    exercises: ["lat_pulldown", "t_bar_row", "hyperextension", "reverse_fly_machine", "seated_db_curl", "machine_curl"],
  },
  {
    id: "legs",
    name: "Ноги",
    exercises: ["leg_press", "smith_squat", "seated_leg_curl", "leg_extension", "calf_raise", "glute_kickback_machine"],
  },
];

export const EXERCISE_NOTES_DIR = "Зал/Упражнения";
