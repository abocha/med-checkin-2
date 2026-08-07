function isLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeText(value, field, { required = false, maxLength = 1000 } = {}) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (required && !text) throw new TypeError(`${field} is required`);
  return text.slice(0, maxLength);
}

export function normalizeTreatmentEvent(input = {}) {
  const effectiveDate = input.effectiveDate === null || input.effectiveDate === ''
    ? null
    : input.effectiveDate;
  if (effectiveDate !== null && !isLocalDate(effectiveDate)) throw new TypeError('Invalid effectiveDate');
  if (!Array.isArray(input.regimen)) throw new TypeError('regimen must be an array');
  const regimen = input.regimen.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`Invalid regimen item ${index + 1}`);
    const name = normalizeText(item.name, 'Medication name', { required: true, maxLength: 200 });
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new TypeError(`Invalid amount for ${name}`);
    const unit = normalizeText(item.unit, 'Medication unit', { required: true, maxLength: 50 });
    const timing = normalizeText(item.timing, 'Medication timing', { maxLength: 200 }) || null;
    return { name, amount, unit, timing };
  });
  return { effectiveDate, regimen, note: normalizeText(input.note, 'Treatment note', { maxLength: 4000 }) };
}

export function rowToTreatmentEvent(row) {
  if (!row) return null;
  let regimen;
  try { regimen = JSON.parse(row.regimen_json); } catch { throw new Error(`Invalid stored regimen JSON for treatment event ${row.id}`); }
  return {
    id: row.id,
    effectiveDate: row.effective_date,
    regimen,
    note: row.note ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
