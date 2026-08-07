(function (root) {
  'use strict';

  const TOKEN_KEY = 'med-checkin-token';
  const VIEWS = new Set(['checkin', 'history', 'analytics', 'settings']);
  const SLOTS = new Set(['13:00', '22:00']);

  function readBrowserRuntime(locationLike, storage) {
    const url = new URL(locationLike.href);
    const queryToken = (url.searchParams.get('token') || '').trim();
    if (queryToken) storage.setItem(TOKEN_KEY, queryToken);
    const token = queryToken || (storage.getItem(TOKEN_KEY) || '').trim();
    const viewValue = url.searchParams.get('view') || 'checkin';
    const dateValue = url.searchParams.get('date') || null;
    const slotValue = url.searchParams.get('slot') || null;

    url.searchParams.delete('token');
    return {
      token,
      apiBase: locationLike.origin,
      view: VIEWS.has(viewValue) ? viewValue : 'checkin',
      localDate: /^\d{4}-\d{2}-\d{2}$/.test(dateValue || '') ? dateValue : null,
      slot: SLOTS.has(slotValue) ? slotValue : null,
      cleanUrl: `${url.pathname}${url.search}${url.hash}`
    };
  }

  function applyBrowserRuntime(windowLike) {
    const runtime = readBrowserRuntime(windowLike.location, windowLike.sessionStorage);
    const current = `${new URL(windowLike.location.href).pathname}${new URL(windowLike.location.href).search}${new URL(windowLike.location.href).hash}`;
    if (runtime.cleanUrl !== current) windowLike.history.replaceState({}, '', runtime.cleanUrl);
    return runtime;
  }

  root.MedCheckinStartup = { readBrowserRuntime, applyBrowserRuntime };
})(globalThis);
