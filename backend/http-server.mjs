import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { localDateString, slotForTime } from './domain.mjs';
import { getDueReminder } from './reminders.mjs';
import { buildAnalytics } from './analytics.mjs';

const BODY_LIMIT = 256 * 1024;

const ASSET_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function resolveResourceRoot(resourcesDir) {
  if (!resourcesDir) return null;
  const value = resourcesDir instanceof URL ? fileURLToPath(resourcesDir) : String(resourcesDir);
  return resolve(value);
}

function serveFile(res, path, contentType, extraHeaders = {}) {
  const body = readFileSync(path);
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

function json(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function text(res, status, value, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(value),
    'cache-control': 'no-store'
  });
  res.end(value);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('Payload too large');
        error.statusCode = 413;
        return reject(error);
      }
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { const error = new Error('Invalid JSON'); error.statusCode = 400; reject(error); }
    });
    req.on('error', reject);
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const textValue = Array.isArray(value) ? value.join('|') : String(value);
  return /[",\n\r]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
}

export function rowsToCsv(rows) {
  const fields = [
    'localDate','kind','period','scheduledFor','observedAt','recordedAt','updatedAt','mood','anxiety','irritability','energy','focus','functioning',
    'sleepQuality','appetite','nightSleepHours','daySleepHours','sleepStart','wakeTime','context','symptoms','activation','notes','redFlags'
  ];
  return [fields.join(','), ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(','))].join('\r\n');
}

function safeSettings(input, current) {
  const result = { ...current };
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.dayTime ?? '')) result.dayTime = input.dayTime;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.eveningTime ?? '')) result.eveningTime = input.eveningTime;
  if (Number.isFinite(Number(input.catchupHours))) result.catchupHours = Math.min(12, Math.max(1, Number(input.catchupHours)));
  if (Number.isFinite(Number(input.repeatMinutes))) result.repeatMinutes = Math.min(240, Math.max(15, Number(input.repeatMinutes)));
  if (input.remindersPausedUntil === null || typeof input.remindersPausedUntil === 'string') result.remindersPausedUntil = input.remindersPausedUntil;
  return result;
}

export function createEventHub() {
  const clients = new Set();
  return {
    add(res) { clients.add(res); },
    remove(res) { clients.delete(res); },
    broadcast(event, data) {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const client of [...clients]) {
        try { client.write(payload); } catch { clients.delete(client); }
      }
    },
    get size() { return clients.size; }
  };
}

export function createHttpServer({ repo, token, dataDir, resourcesDir = null, hostActions = null, now = () => new Date(), eventHub = createEventHub(), onControl = async () => {}, onPersisted = async () => {} }) {
  const resourceRoot = resolveResourceRoot(resourcesDir);
  let server;
  let port = null;

  async function route(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization,content-type');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (url.pathname === '/health') return json(res, 200, { ok: true, pid: process.pid, dataDir });

    if (url.pathname !== '/app' && !url.pathname.startsWith('/app/') && !url.pathname.startsWith('/api/')) {
      return json(res, 404, { error: 'not_found' });
    }

    if (url.pathname === '/app' || url.pathname === '/app/') {
      if (url.searchParams.get('token') !== token) return json(res, 401, { error: 'unauthorized' });
      if (!resourceRoot) return json(res, 404, { error: 'ui_unavailable' });
      return serveFile(res, resolve(resourceRoot, 'index.html'), ASSET_TYPES['.html'], {
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      });
    }

    if (url.pathname.startsWith('/app/')) {
      if (!resourceRoot) return json(res, 404, { error: 'ui_unavailable' });
      let relative;
      try { relative = decodeURIComponent(url.pathname.slice('/app/'.length)); } catch { return json(res, 404, { error: 'not_found' }); }
      if (!relative || relative.includes('\0')) return json(res, 404, { error: 'not_found' });
      const candidate = resolve(resourceRoot, relative);
      if (candidate !== resourceRoot && !candidate.startsWith(resourceRoot + sep)) return json(res, 404, { error: 'not_found' });
      if (!existsSync(candidate) || !statSync(candidate).isFile()) return json(res, 404, { error: 'not_found' });
      return serveFile(res, candidate, ASSET_TYPES[extname(candidate).toLowerCase()] || 'application/octet-stream');
    }

    const queryToken = url.searchParams.get('token');
    const auth = req.headers.authorization === `Bearer ${token}` || queryToken === token;
    if (!auth) return json(res, 401, { error: 'unauthorized' });

    if (url.pathname === '/api/v1/events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': '*'
      });
      res.write(`event: connected\ndata: {"ok":true}\n\n`);
      eventHub.add(res);
      const keepAlive = setInterval(() => res.write(': keepalive\n\n'), 25000);
      req.on('close', () => { clearInterval(keepAlive); eventHub.remove(res); });
      return;
    }

    if (url.pathname === '/api/v1/bootstrap' && req.method === 'GET') {
      const currentTime = now();
      const localDate = localDateString(currentTime);
      const slot = slotForTime(currentTime, repo.getSettings());
      const period = slot === '13:00' ? 'day' : 'evening';
      return json(res, 200, {
        settings: repo.getSettings(),
        current: { localDate, period, checkin: repo.getScheduledCheckin(localDate, period) },
        recent: repo.listCheckins({ limit: 6 }),
        currentTreatment: repo.getEffectiveTreatment(localDate)
      });
    }

    if (url.pathname === '/api/v1/checkins' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.kind === 'scheduled') {
        const existing = repo.getScheduledCheckin(body.localDate, body.period);
        if (existing) return json(res, 409, { error: 'scheduled_exists', existing });
      }
      const saved = repo.createCheckin(body, now());
      if (saved.kind === 'scheduled') repo.clearReminderState(saved.localDate, saved.period);
      await onPersisted();
      eventHub.broadcast('checkin-saved', saved);
      return json(res, 201, saved);
    }

    if (url.pathname === '/api/v1/checkins' && req.method === 'GET') {
      return json(res, 200, { items: repo.listCheckins({
        limit: url.searchParams.get('limit') ?? 100,
        offset: url.searchParams.get('offset') ?? 0,
        from: url.searchParams.get('from'), to: url.searchParams.get('to'),
        kind: url.searchParams.get('kind'), period: url.searchParams.get('period')
      }) });
    }

    if (url.pathname === '/api/v1/checkin' && req.method === 'GET') {
      const requestedPeriod = url.searchParams.get('period')
        ?? (url.searchParams.get('slot') === '13:00' ? 'day' : url.searchParams.get('slot') === '22:00' ? 'evening' : null);
      const item = repo.getScheduledCheckin(url.searchParams.get('date'), requestedPeriod);
      return json(res, item ? 200 : 404, item ?? { error: 'not_found' });
    }

    const checkinId = url.pathname.match(/^\/api\/v1\/checkins\/(\d+)$/);
    if (checkinId && req.method === 'GET') {
      const item = repo.getCheckinById(checkinId[1]);
      return json(res, item ? 200 : 404, item ?? { error: 'not_found' });
    }
    if (checkinId && req.method === 'PUT') {
      const body = await readBody(req);
      const saved = repo.updateCheckin(checkinId[1], body, now());
      if (!saved) return json(res, 404, { error: 'not_found' });
      if (saved.kind === 'scheduled') repo.clearReminderState(saved.localDate, saved.period);
      await onPersisted();
      eventHub.broadcast('checkin-saved', saved);
      return json(res, 200, saved);
    }
    if (checkinId && req.method === 'DELETE') {
      const deleted = repo.deleteCheckin(checkinId[1]);
      if (!deleted) return json(res, 404, { error: 'not_found' });
      await onPersisted();
      res.writeHead(204); return res.end();
    }

    if (url.pathname === '/api/v1/settings' && req.method === 'GET') return json(res, 200, repo.getSettings());
    if (url.pathname === '/api/v1/settings' && req.method === 'PUT') {
      const body = await readBody(req);
      const saved = repo.saveSettings(safeSettings(body, repo.getSettings()));
      await onPersisted();
      eventHub.broadcast('settings-changed', saved);
      return json(res, 200, saved);
    }

    if (url.pathname === '/api/v1/treatment-events' && req.method === 'GET') {
      return json(res, 200, { items: repo.listTreatmentEvents() });
    }
    if (url.pathname === '/api/v1/treatment-events' && req.method === 'POST') {
      const saved = repo.createTreatmentEvent(await readBody(req), now());
      await onPersisted();
      eventHub.broadcast('treatment-changed', saved);
      return json(res, 201, saved);
    }
    const treatmentId = url.pathname.match(/^\/api\/v1\/treatment-events\/(\d+)$/);
    if (treatmentId && req.method === 'PUT') {
      const saved = repo.updateTreatmentEvent(treatmentId[1], await readBody(req), now());
      if (!saved) return json(res, 404, { error: 'not_found' });
      await onPersisted();
      eventHub.broadcast('treatment-changed', saved);
      return json(res, 200, saved);
    }
    if (treatmentId && req.method === 'DELETE') {
      if (!repo.deleteTreatmentEvent(treatmentId[1])) return json(res, 404, { error: 'not_found' });
      await onPersisted();
      eventHub.broadcast('treatment-changed', { deletedId: Number(treatmentId[1]) });
      res.writeHead(204); return res.end();
    }

    if (url.pathname === '/api/v1/analytics' && req.method === 'GET') {
      return json(res, 200, buildAnalytics(repo.listCheckins({ limit: 1000 }), repo.getSettings()));
    }

    if (url.pathname === '/api/v1/reminders/due' && req.method === 'GET') {
      const currentTime = now();
      const date = localDateString(currentTime);
      const completed = new Set(repo.listCheckins({ from: date, to: date, kind: 'scheduled', limit: 10 }).map((row) => `${row.localDate}|${row.period}`));
      const due = getDueReminder(currentTime, repo.getSettings(), completed, repo.getReminderStates(date));
      return json(res, 200, { due });
    }

    if (url.pathname === '/api/v1/host/poll' && req.method === 'GET') {
      const currentTime = now();
      const date = localDateString(currentTime);
      const completed = new Set(repo.listCheckins({ from: date, to: date, kind: 'scheduled', limit: 10 }).map((row) => `${row.localDate}|${row.period}`));
      const due = getDueReminder(currentTime, repo.getSettings(), completed, repo.getReminderStates(date));
      return json(res, 200, { actions: hostActions?.drain() ?? [], due });
    }

    const reminderAction = url.pathname.match(/^\/api\/v1\/reminders\/(snooze|dismiss|notified)$/);
    if (reminderAction && req.method === 'POST') {
      const body = await readBody(req);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.localDate ?? '') || !['day','evening'].includes(body.period)) return json(res, 400, { error: 'invalid_reminder' });
      const currentTime = now();
      const patch = reminderAction[1] === 'snooze'
        ? { snoozedUntil: new Date(currentTime.getTime() + Math.max(15, Number(body.minutes) || repo.getSettings().repeatMinutes) * 60000).toISOString(), notifiedAt: null }
        : reminderAction[1] === 'dismiss'
          ? { dismissedAt: currentTime.toISOString() }
          : { notifiedAt: currentTime.toISOString() };
      return json(res, 200, repo.saveReminderState(body.localDate, body.period, patch));
    }

    if (url.pathname === '/api/v1/export.csv' && req.method === 'GET') return text(res, 200, rowsToCsv(repo.exportRows()), 'text/csv; charset=utf-8');
    if (url.pathname === '/api/v1/export.json' && req.method === 'GET') return json(res, 200, { exportedAt: new Date().toISOString(), checkins: repo.exportRows(), settings: repo.getSettings() });

    const control = url.pathname.match(/^\/api\/v1\/control\/(show|close-window|restart-host|quit|heartbeat)$/);
    if (control && req.method === 'POST') {
      const command = control[1];
      if (command === 'show') hostActions?.enqueue({ type: 'open', view: 'checkin' });
      if (command === 'close-window') hostActions?.enqueue({ type: 'close-window' });
      if (!['show', 'close-window'].includes(command)) await onControl(command);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'not_found' });
  }

  server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (res.headersSent) return res.destroy(error);
      const status = error.statusCode ?? (error instanceof TypeError ? 400 : 500);
      json(res, status, { error: status < 500 ? error.message : 'internal_error' });
    });
  });

  return {
    eventHub,
    get port() { return port; },
    listen(requestedPort = 0) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(requestedPort, '127.0.0.1', () => {
          port = server.address().port;
          resolve(port);
        });
      });
    },
    close() { return new Promise((resolve) => server.close(resolve)); }
  };
}
