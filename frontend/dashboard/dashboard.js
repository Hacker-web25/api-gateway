const DEMO_KEYS = [
  { key: 'demo-key-1', name: 'demo-client' },
  { key: 'demo-key-2', name: 'second-client' }
];

const store = window.localStorage;
const baseInput = document.getElementById('base');
const lamp = document.getElementById('lamp');
const linkState = document.getElementById('linkState');
const track = document.getElementById('track');
const packetLayer = document.getElementById('packets');
const nodeOut = document.getElementById('nodeOut');
const bucketsBox = document.getElementById('buckets');
const logBox = document.getElementById('log');
const limitRange = document.getElementById('limit');
const limitOut = document.getElementById('limitOut');
const windowOut = document.getElementById('windowOut');
const refillNote = document.getElementById('refillNote');
const canvas = document.getElementById('trace');
const ctx = canvas.getContext('2d');

const gates = {
  key: document.getElementById('gateKey'),
  token: document.getElementById('gateToken'),
  route: document.getElementById('gateRoute')
};

let base = store.getItem('gatewayBase') || 'http://127.0.0.1:3000';
let limit = 5;
let windowSeconds = 60;
let topSignature = null;
let firstLoad = true;
let packets = [];
let running = false;
let marks = null;
let events = [];
let bucketState = {};

baseInput.value = base;

function clean(value) {
  let text = value.trim().replace(/\/+$/, '');
  if (text && !/^https?:\/\//i.test(text)) {
    text = 'http://' + text;
  }
  return text;
}

async function call(path, options) {
  const response = await fetch(base + path, options || {});
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (error) {
    body = null;
  }
  return { status: response.status, body: body };
}

function setLink(up, note) {
  lamp.classList.toggle('up', up);
  linkState.textContent = note;
}

function measure() {
  const box = track.getBoundingClientRect();
  const centre = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.left - box.left + rect.width / 2;
  };
  marks = {
    y: document.querySelector('.wire').getBoundingClientRect().top - box.top + 1,
    start: centre(document.getElementById('nodeIn')),
    key: centre(gates.key),
    token: centre(gates.token),
    route: centre(gates.route),
    end: centre(nodeOut),
    floor: box.height
  };
}

function outcomeOf(status) {
  if (status === 401) return { cls: 'turn', gate: 'key', flash: 'flash-turn' };
  if (status === 429) return { cls: 'deny', gate: 'token', flash: 'flash' };
  if (status === 503) return { cls: 'deny', gate: 'token', flash: 'flash' };
  if (status === 502 || status === 504) return { cls: 'deny', gate: 'route', flash: 'flash' };
  return { cls: 'ok', gate: null, flash: null };
}

function spawn(status) {
  if (!marks) measure();
  const outcome = outcomeOf(status);
  const element = document.createElement('div');
  element.className = 'pk';
  element.style.left = marks.start + 'px';
  element.style.top = marks.y + 'px';
  packetLayer.appendChild(element);

  packets.push({
    el: element,
    x: marks.start,
    y: marks.y,
    stop: outcome.gate ? marks[outcome.gate] : marks.end,
    outcome: outcome,
    phase: 'run',
    vy: 0,
    alpha: 1
  });

  if (!running) {
    running = true;
    requestAnimationFrame(step);
  }
}

let lastFrame = 0;

function step(now) {
  const delta = lastFrame ? Math.min(now - lastFrame, 64) : 16;
  lastFrame = now;

  for (let index = packets.length - 1; index >= 0; index--) {
    const packet = packets[index];

    if (packet.phase === 'run') {
      packet.x += delta * 0.42;
      if (packet.x >= packet.stop) {
        packet.x = packet.stop;
        if (packet.outcome.gate) {
          packet.phase = 'fall';
          packet.el.classList.add(packet.outcome.cls);
          flash(packet.outcome.gate, packet.outcome.flash);
        } else {
          packet.phase = 'gone';
          packet.el.classList.add('ok');
          nodeOut.classList.add('hit');
          window.setTimeout(() => nodeOut.classList.remove('hit'), 160);
        }
      }
      packet.el.style.left = packet.x + 'px';
    } else if (packet.phase === 'fall') {
      packet.vy += delta * 0.0022;
      packet.y += packet.vy * delta;
      packet.alpha -= delta * 0.0022;
      packet.el.style.top = packet.y + 'px';
      packet.el.style.opacity = Math.max(packet.alpha, 0);
      if (packet.alpha <= 0 || packet.y > marks.floor) packet.phase = 'gone';
    }

    if (packet.phase === 'gone') {
      packet.el.remove();
      packets.splice(index, 1);
    }
  }

  if (packets.length) {
    requestAnimationFrame(step);
  } else {
    running = false;
    lastFrame = 0;
  }
}

const flashTimers = {};

function flash(name, className) {
  const gate = gates[name];
  gate.classList.add(className);
  window.clearTimeout(flashTimers[name]);
  flashTimers[name] = window.setTimeout(() => {
    gate.classList.remove('flash', 'flash-turn');
  }, 260);
}

function renderBuckets(readings) {
  bucketsBox.textContent = '';

  readings.forEach((reading) => {
    const empty = reading.remaining === 0;
    const wrap = document.createElement('div');

    const top = document.createElement('div');
    top.className = 'bucket-top';
    top.innerHTML =
      '<span class="bucket-name"></span>' +
      '<span class="bucket-key"></span>' +
      '<span class="bucket-count"><b></b> of ' + limit + '</span>';
    top.querySelector('.bucket-name').textContent = reading.name;
    top.querySelector('.bucket-key').textContent = reading.key;
    top.querySelector('b').textContent = reading.ok ? reading.remaining : '--';
    if (empty) top.querySelector('.bucket-count').classList.add('empty');
    wrap.appendChild(top);

    const pips = document.createElement('div');
    pips.className = 'pips';
    for (let index = 0; index < limit; index++) {
      const pip = document.createElement('div');
      pip.className = index < reading.remaining ? 'pip full' : 'pip';
      pips.appendChild(pip);
    }
    wrap.appendChild(pips);

    const bar = document.createElement('div');
    bar.className = 'refill';
    const fill = document.createElement('div');
    fill.className = 'refill-fill';
    bar.appendChild(fill);
    wrap.appendChild(bar);

    const note = document.createElement('div');
    note.className = 'refill-note';
    const seconds = Math.round(windowSeconds / limit);
    note.textContent = reading.remaining >= limit
      ? 'bucket full'
      : 'next token in about ' + seconds + 's';
    wrap.appendChild(note);

    const held = bucketState[reading.key];
    if (held && reading.remaining < limit) {
      const elapsed = (Date.now() - held.since) / 1000;
      fill.style.width = Math.min(100, (elapsed / seconds) * 100) + '%';
    }

    bucketsBox.appendChild(wrap);
  });
}

function trackBucket(reading) {
  const held = bucketState[reading.key];
  if (!held || held.remaining !== reading.remaining) {
    bucketState[reading.key] = { remaining: reading.remaining, since: Date.now() };
  }
}

function rowFor(entry, fresh) {
  const outcome = outcomeOf(entry.status);
  const row = document.createElement('div');
  row.className = 'row ' + (outcome.cls === 'ok' ? 'pass' : outcome.cls);
  if (fresh) row.classList.add('fresh');
  row.innerHTML = '<span class="t"></span><span></span><span></span><span class="c"></span>' +
    '<span class="s"></span><span class="ms"></span>';
  const cells = row.children;
  cells[0].textContent = new Date(entry.time).toLocaleTimeString('en-GB', { hour12: false });
  cells[1].textContent = entry.method;
  cells[2].textContent = entry.path;
  cells[3].textContent = entry.client;
  cells[4].textContent = entry.status;
  cells[5].textContent = entry.durationMs;
  return row;
}

function signature(entry) {
  return entry.time + entry.path + entry.status + entry.durationMs;
}

function renderLogs(entries) {
  if (!entries.length) {
    logBox.innerHTML = '<div class="empty">No requests yet. Send one from the client laptop.</div>';
    topSignature = null;
    return;
  }

  let freshCount = 0;
  if (firstLoad) {
    firstLoad = false;
  } else if (topSignature === null) {
    freshCount = entries.length;
  } else {
    const index = entries.findIndex((entry) => signature(entry) === topSignature);
    freshCount = index === -1 ? entries.length : index;
  }

  topSignature = signature(entries[0]);

  for (let index = freshCount - 1; index >= 0; index--) {
    spawn(entries[index].status);
    events.push({ t: Date.now(), status: entries[index].status });
  }

  logBox.textContent = '';
  entries.forEach((entry, index) => {
    logBox.appendChild(rowFor(entry, index < freshCount));
  });
}

function sizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawTrace() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const middle = Math.round(height / 2) + 0.5;
  const now = Date.now();
  const span = 60000;

  ctx.clearRect(0, 0, width, height);

  const reach = height * 0.34;

  ctx.strokeStyle = 'rgba(27,56,64,.55)';
  ctx.lineWidth = 1;
  [middle - reach, middle - reach / 2, middle + reach / 2, middle + reach].forEach((y) => {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
  });

  for (let seconds = 0; seconds <= 60; seconds += 5) {
    const x = Math.round(width - (seconds / 60) * width) + 0.5;
    const long = seconds % 15 === 0;
    ctx.strokeStyle = long ? '#2A4E57' : 'rgba(27,56,64,.7)';
    ctx.beginPath();
    ctx.moveTo(x, middle - (long ? 7 : 4));
    ctx.lineTo(x, middle + (long ? 7 : 4));
    ctx.stroke();
  }

  ctx.strokeStyle = '#2A4E57';
  ctx.beginPath();
  ctx.moveTo(0, middle);
  ctx.lineTo(width, middle);
  ctx.stroke();

  events = events.filter((event) => now - event.t < span);

  events.forEach((event) => {
    const x = Math.round(width - 4 - ((now - event.t) / span) * (width - 8)) + 0.5;
    const outcome = outcomeOf(event.status);
    const up = outcome.cls === 'ok';
    ctx.strokeStyle = up ? '#35D6A4' : (outcome.cls === 'turn' ? '#7E9CBA' : '#FF5A47');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, middle);
    ctx.lineTo(x, up ? middle - reach : middle + reach);
    ctx.stroke();
  });
}

async function readConfig() {
  const result = await call('/config');
  if (result.status === 200 && result.body) {
    limit = result.body.limit;
    windowSeconds = result.body.windowSeconds;
    if (document.activeElement !== limitRange) {
      limitRange.value = String(limit);
      limitOut.textContent = String(limit);
    }
    windowOut.textContent = String(windowSeconds);
    const seconds = Math.round(windowSeconds / limit);
    refillNote.textContent = 'refills one token every ' + seconds + 's';
  }
}

async function readBuckets() {
  const readings = await Promise.all(DEMO_KEYS.map(async (entry) => {
    try {
      const result = await call('/rate-limit', { headers: { 'x-api-key': entry.key } });
      if (result.status === 200 && result.body) {
        return { key: entry.key, name: result.body.client, remaining: result.body.remaining, ok: true };
      }
    } catch (error) {
      return { key: entry.key, name: entry.name, remaining: 0, ok: false };
    }
    return { key: entry.key, name: entry.name, remaining: 0, ok: false };
  }));

  readings.forEach(trackBucket);
  renderBuckets(readings);
}

async function tick() {
  try {
    const health = await call('/health');
    setLink(health.status === 200, health.status === 200 ? base : 'redis down');

    const [stats, logs] = await Promise.all([call('/stats'), call('/logs')]);

    if (stats.status === 200 && stats.body) {
      document.getElementById('statAllowed').textContent = stats.body.allowed;
      document.getElementById('statRejected').textContent = stats.body.rejected;
      document.getElementById('statTotal').textContent = stats.body.total;
    }

    if (logs.status === 200 && Array.isArray(logs.body)) {
      renderLogs(logs.body);
    }

    await readBuckets();
  } catch (error) {
    setLink(false, 'no answer from ' + base);
  }
}

limitRange.addEventListener('input', () => {
  limitOut.textContent = limitRange.value;
});

limitRange.addEventListener('change', async () => {
  await call('/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-api-key': DEMO_KEYS[0].key },
    body: JSON.stringify({ limit: Number(limitRange.value) })
  });
  bucketState = {};
  await readConfig();
});

document.getElementById('reset').addEventListener('click', async () => {
  await call('/reset', { method: 'POST', headers: { 'x-api-key': DEMO_KEYS[0].key } });
  events = [];
  topSignature = null;
  firstLoad = true;
  bucketState = {};
});

document.getElementById('connect').addEventListener('click', () => {
  base = clean(baseInput.value);
  baseInput.value = base;
  store.setItem('gatewayBase', base);
  topSignature = null;
  firstLoad = true;
  events = [];
  readConfig();
  tick();
});

window.addEventListener('resize', () => {
  measure();
  sizeCanvas();
});

sizeCanvas();
measure();
readConfig();
tick();
window.setInterval(tick, 700);
window.setInterval(drawTrace, 100);
window.setInterval(readConfig, 4000);
