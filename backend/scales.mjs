export const SCALE_LABEL_MAX_LENGTH = 120;

export const BUILTIN_SCALE_DEFINITIONS = Object.freeze([
  { id: 'mood', label: 'Настроение', active: true, sortOrder: 0 },
  { id: 'anxiety', label: 'Тревога', active: true, sortOrder: 1 },
  { id: 'irritability', label: 'Раздражительность', active: true, sortOrder: 2 },
  { id: 'energy', label: 'Энергия', active: true, sortOrder: 3 },
  { id: 'focus', label: 'Концентрация', active: true, sortOrder: 4 },
  { id: 'functioning', label: 'Функционирование', active: true, sortOrder: 5 },
  { id: 'sleepQuality', label: 'Качество сна', active: true, sortOrder: 6 },
  { id: 'appetite', label: 'Аппетит', active: true, sortOrder: 7 }
]);

export const LEGACY_SCALE_COLUMNS = Object.freeze({
  mood: 'mood', anxiety: 'anxiety', irritability: 'irritability', energy: 'energy',
  focus: 'focus', functioning: 'functioning', sleepQuality: 'sleep_quality', appetite: 'appetite'
});

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function normalizeScaleDefinition(definition, { requireId = true } = {}) {
  if (!plainObject(definition)) throw new TypeError('Invalid scale definition');
  const id = definition.id;
  if ((requireId && (typeof id !== 'string' || !id.trim() || id.length > 200))
    || (!requireId && id !== undefined && (typeof id !== 'string' || !id.trim() || id.length > 200))) {
    throw new TypeError('Invalid scale definition id');
  }
  const label = typeof definition.label === 'string' ? definition.label.trim() : '';
  if (!label || label.length > SCALE_LABEL_MAX_LENGTH) throw new TypeError('Invalid scale label');
  if (typeof definition.active !== 'boolean') throw new TypeError('Invalid scale active state');
  if (!Number.isInteger(definition.sortOrder) || definition.sortOrder < 0) throw new TypeError('Invalid scale sort order');
  return { ...(requireId || id !== undefined ? { id } : {}), label, active: definition.active, sortOrder: definition.sortOrder };
}

export function validateScaleDefinitions(definitions, { requireBuiltIns = true } = {}) {
  if (!Array.isArray(definitions) || definitions.length === 0) throw new TypeError('Scale definitions are required');
  const normalized = definitions.map((definition) => normalizeScaleDefinition(definition));
  const ids = new Set(normalized.map((definition) => definition.id));
  if (ids.size !== normalized.length) throw new TypeError('Duplicate scale definition id');
  if (requireBuiltIns && BUILTIN_SCALE_DEFINITIONS.some((definition) => !ids.has(definition.id))) {
    throw new TypeError('Missing built-in scale definition');
  }
  const active = normalized.filter((definition) => definition.active).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  if (active.length === 0) throw new TypeError('At least one scale must remain active');
  if (active.some((definition, index) => definition.sortOrder !== index)) throw new TypeError('Active scale order must be dense');
  return normalized;
}

export function activeScaleIds(definitions) {
  return validateScaleDefinitions(definitions, { requireBuiltIns: false })
    .filter((definition) => definition.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((definition) => definition.id);
}

export function normalizeScaleValues(values, definitions, { requiredIds = null, allowedInactiveIds = [] } = {}) {
  if (!plainObject(values)) throw new TypeError('Scale values must be an object');
  const known = new Map(validateScaleDefinitions(definitions, { requireBuiltIns: false }).map((definition) => [definition.id, definition]));
  const allowedInactive = new Set(allowedInactiveIds);
  const keys = Object.keys(values);
  for (const id of keys) {
    const definition = known.get(id);
    if (!definition) throw new TypeError(`Unknown scale ${id}`);
    if (!definition.active && !allowedInactive.has(id)) throw new TypeError(`Archived scale ${id} cannot be newly used`);
  }
  if (requiredIds !== null) {
    if (!Array.isArray(requiredIds) || new Set(requiredIds).size !== requiredIds.length
      || keys.length !== requiredIds.length || keys.some((id) => !new Set(requiredIds).has(id))) {
      throw new TypeError('Scale set must match required scales exactly');
    }
  }
  return Object.fromEntries(keys.map((id) => {
    const number = values[id];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 10) throw new TypeError(`Invalid ${id}`);
    return [id, Math.round(number * 10) / 10];
  }));
}
