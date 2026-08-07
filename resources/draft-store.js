(() => {
  const prefix = 'med-checkin-draft:';
  const storageKey = (key) => `${prefix}${key}`;

  globalThis.MedCheckinDrafts = {
    scheduledKey(localDate, period) { return `scheduled:${localDate}:${period}`; },
    extraKey(localKey) { return `extra:${localKey}`; },
    checkinKey(id) { return `checkin:${id}`; },
    read(key) {
      try {
        const value = localStorage.getItem(storageKey(key));
        return value ? JSON.parse(value) : null;
      } catch { return null; }
    },
    write(key, draft) {
      localStorage.setItem(storageKey(key), JSON.stringify(draft));
    },
    remove(key) {
      localStorage.removeItem(storageKey(key));
    }
  };
})();
