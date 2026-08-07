import { localDateString, scheduledWindows, DEFAULT_SETTINGS } from './domain.mjs';

export function getDueReminder(now, settings = DEFAULT_SETTINGS, completedSlots = new Set(), states = {}) {
  const pause = settings.remindersPausedUntil ? new Date(settings.remindersPausedUntil) : null;
  if (pause && pause > now) return null;
  const dateKey = localDateString(now);
  for (const window of scheduledWindows(now, settings)) {
    const end = new Date(window.scheduledAt.getTime() + Number(settings.catchupHours ?? 4) * 3600000);
    if (now < window.scheduledAt || now > end) continue;
    const key = `${dateKey}|${window.slot}`;
    if (completedSlots.has(key)) continue;
    const state = states[window.slot] ?? {};
    if (state.dismissedAt) continue;
    if (state.snoozedUntil && new Date(state.snoozedUntil) > now) continue;
    if (state.notifiedAt) {
      const nextRepeat = new Date(new Date(state.notifiedAt).getTime() + Number(settings.repeatMinutes ?? 30) * 60000);
      if (nextRepeat > now) continue;
    }
    return {
      localDate: dateKey,
      slot: window.slot,
      scheduledAt: window.scheduledAt.toISOString(),
      overdueMinutes: Math.max(0, Math.floor((now - window.scheduledAt) / 60000))
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
