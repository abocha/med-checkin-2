export const TRACKED_ITEM_CATEGORIES = Object.freeze(['context', 'symptoms', 'activation']);
export const TRACKED_ITEM_LABEL_MAX_LENGTH = 120;

const builtIn = [
  ['context', 'caffeine', 'Кофеин'],
  ['context', 'stress', 'Выраженный стресс'],
  ['context', 'conflict', 'Конфликт'],
  ['context', 'illnessPain', 'Болезнь/боль'],
  ['context', 'physicalActivity', 'Физическая активность'],
  ['context', 'positiveProductiveDay', 'Приятный/продуктивный день'],
  ['symptoms', 'dizziness', 'Головокружение'],
  ['symptoms', 'headache', 'Головная боль'],
  ['symptoms', 'nausea', 'Тошнота/живот'],
  ['symptoms', 'sweating', 'Потливость'],
  ['symptoms', 'palpitations', 'Сердцебиение'],
  ['symptoms', 'brainZaps', 'Brain zaps'],
  ['symptoms', 'unusualDreams', 'Необычные сны'],
  ['symptoms', 'crying', 'Плаксивость'],
  ['activation', 'reducedSleepNeed', 'Меньше потребности во сне'],
  ['activation', 'racingThoughts', 'Ускорение мыслей'],
  ['activation', 'talkativeness', 'Разговорчивость'],
  ['activation', 'innerMotor', 'Внутренний мотор'],
  ['activation', 'impulsivity', 'Импульсивность'],
  ['activation', 'elevatedAgitated', 'Подъём/возбуждение']
];

export const BUILTIN_TRACKED_ITEMS = Object.freeze(builtIn.map(([category, id, label], sortOrder) => Object.freeze({
  id, category, label, active: true,
  sortOrder: builtIn.filter(([itemCategory]) => itemCategory === category).findIndex(([, itemId]) => itemId === id)
})));

const builtInCategories = new Map(BUILTIN_TRACKED_ITEMS.map((item) => [item.id, item.category]));

export function normalizeTrackedItem(item, { requireId = true } = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Invalid tracked item');
  const id = typeof item.id === 'string' ? item.id : '';
  if (requireId && (!id || id.length > 200)) throw new TypeError('Invalid tracked item id');
  if (!TRACKED_ITEM_CATEGORIES.includes(item.category)) throw new TypeError('Invalid tracked item category');
  const label = typeof item.label === 'string' ? item.label.trim() : '';
  if (!label || label.length > TRACKED_ITEM_LABEL_MAX_LENGTH) throw new TypeError('Invalid tracked item label');
  if (typeof item.active !== 'boolean') throw new TypeError('Invalid tracked item active state');
  if (!Number.isInteger(item.sortOrder) || item.sortOrder < 0) throw new TypeError('Invalid tracked item order');
  if (builtInCategories.has(id) && builtInCategories.get(id) !== item.category) throw new TypeError('Built-in tracked item category is immutable');
  return { id, category: item.category, label, active: item.active, sortOrder: item.sortOrder };
}

export function validateTrackedItems(items, { requireBuiltIns = true } = {}) {
  if (!Array.isArray(items)) throw new TypeError('Invalid tracked items');
  const ids = new Set();
  const normalized = items.map((item) => {
    const value = normalizeTrackedItem(item);
    if (ids.has(value.id)) throw new TypeError('Duplicate tracked item id');
    ids.add(value.id);
    return value;
  });
  if (requireBuiltIns) {
    for (const builtInItem of BUILTIN_TRACKED_ITEMS) {
      const item = normalized.find((candidate) => candidate.id === builtInItem.id);
      if (!item || item.category !== builtInItem.category) throw new TypeError('Missing or moved built-in tracked item');
    }
  }
  for (const category of TRACKED_ITEM_CATEGORIES) {
    const orders = normalized.filter((item) => item.category === category).map((item) => item.sortOrder).sort((a, b) => a - b);
    if (orders.some((order, index) => order !== index)) throw new TypeError('Tracked item order must be dense');
  }
  return normalized;
}

export function trackedIdsForCategory(items, category) {
  return new Set(items.filter((item) => item.category === category).map((item) => item.id));
}
