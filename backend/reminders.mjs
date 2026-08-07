import { localDateString, scheduledWindows, DEFAULT_SETTINGS } from './domain.mjs';

export function getDueReminder(now, settings = DEFAULT_SETTINGS, completedPeriods = new Set(), states = {}) {
  const pause = settings.remindersPausedUntil ? new Date(settings.remindersPausedUntil) : null;
  if (pause && pause > now) return null;
  const currentDateKey = localDateString(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const windows = [...scheduledWindows(yesterday, settings), ...scheduledWindows(now, settings)];
  for (const window of windows) {
    const dateKey = localDateString(window.scheduledAt);
    const end = new Date(window.scheduledAt.getTime() + Number(settings.catchupHours ?? 4) * 3600000);
    if (now < window.scheduledAt || now > end) continue;
    const key = `${dateKey}|${window.period}`;
    if (completedPeriods.has(key)) continue;
    const stateGroup = states[dateKey] ?? (dateKey === currentDateKey ? states : {});
    const state = stateGroup[window.period] ?? {};
    if (state.dismissedAt) continue;
    if (state.snoozedUntil && new Date(state.snoozedUntil) > now) continue;
    if (state.notifiedAt) {
      const nextRepeat = new Date(new Date(state.notifiedAt).getTime() + Number(settings.repeatMinutes ?? 30) * 60000);
      if (nextRepeat > now) continue;
    }
    return {
      localDate: dateKey,
      period: window.period,
      slot: window.slot,
      scheduledAt: window.scheduledAt.toISOString(),
      overdueMinutes: Math.max(0, Math.floor((now - window.scheduledAt) / 60000)),
      repeatMinutes: Number(settings.repeatMinutes ?? 30)
    };
  }
  return null;
}

export function nextWakeup(now, settings = DEFAULT_SETTINGS) {
  for (const window of scheduledWindows(now, settings)) {
    if (window.scheduledAt > now) return window.scheduledAt;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return scheduledWindows(tomorrow, settings)[0].scheduledAt;
}
