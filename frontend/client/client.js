const KEYS = [
  { key: 'demo-key-1', label: 'demo-key-1', bad: false },
  { key: 'demo-key-2', label: 'demo-key-2', bad: false },
  { key: 'not-a-real-key', label: 'a wrong key', bad: true }
];

const CALLS = [
  { id: 'products', label: 'the product list', method: 'GET', path: '/api/products' },
  { id: 'order', label: 'place an order', method: 'POST', path: '/api/orders' }
];

const REASONS = {
  200: ['OK', 'The gateway checked your key, took one token and forwarded this to the backend.'],
  201: ['Created', 'The gateway took one token, forwarded the order and the backend created it.'],
  400: ['Bad Request', 'This reached the backend, but the body was not valid.'],
  401: ['Unauthorized', 'The gateway does not know this key, so it stopped here. No token was spent.'],
  404: ['Not Found', 'Nothing matches that path.'],
  429: ['Too Many Requests', 'Your bucket is empty. The gateway refused this and did not call the backend.'],
  502: ['Bad Gateway', 'The gateway is fine, but the backend did not answer. Is the sample API running?'],
  503: ['Service Unavailable', 'The gateway cannot reach Redis, so it cannot count. It refuses rather than let traffic through uncounted.'],
  504: ['Gateway Timeout', 'The backend took longer than five seconds.']
};

const store = window.localStorage;
const baseInput = document.getElementById('base');
const lamp = document.getElementById('lamp');
const linkState = document.getElementById('linkState');
const pipsBox = document.getElementById('pips');
const remainingOut = document.getElementById('remaining');
const ofLimit = document.getElementById('ofLimit');
const nextToken = document.getElementById('nextToken');
const rateNote = document.getElementById('rateNote');
const answerPanel = document.getElementById('answerPanel');
const codeOut = document.getElementById('code');
const reasonOut = document.getElementById('reason');
const plainOut = document.getElementById('plain');
const timingOut = document.getElementById('timing');
const waitBox = document.getElementById('wait');
const waitN = document.getElementById('waitN');
const bodyOut = document.getElementById('body');
const ticksBox = document.getElementById('ticks');
const tallyOut = document.getElementById('tally');
const sendOne = document.getElementById('sendOne');
const sendTen = document.getElementById('sendTen');
const wireText = document.getElementById('wireText');

let base = store.getItem('gatewayBase') || 'http://127.0.0.1:3000';
let activeKey = KEYS[0];
let activeCall = CALLS[0];
let limit = 5;
let windowSeconds = 60;
let remaining = null;
let lastChange = { value: null, at: Date.now() };
let waitUntil = 0;
let history = [];
let busy = false;

baseInput.value = base;

function clean(value) {
  let text = value.trim().replace(/\/+$/, '');
  if (text && !/^https?:\/\//i.test(text)) text = 'http://' + text;
  return text;
}

function classOf(status) {
  if (status === 401) return 'turn';
  if (status >= 200 && status < 300) return 'pass';
  return 'deny';
}

function buildSegments(box, items, isActive, onPick) {
  box.textContent = '';
  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seg' + (item.bad ? ' bad' : '') + (isActive(item) ? ' on' : '');
    button.textContent = item.label;
    button.addEventListener('click', () => onPick(item));
    box.appendChild(button);
  });
}

function renderWire() {
  const lines = [
    '<span class="hd">' + activeCall.method + '</span> ' + activeCall.path,
    '<span class="hd">host:</span> ' + base.replace(/^https?:\/\//, ''),
    '<span class="hd">x-api-key:</span> <span class="ky">' + activeKey.key + '</span>'
  ];

  if (activeCall.method === 'POST') {
    lines.push('<span class="hd">content-type:</span> application/json');
    lines.push('');
    lines.push('{ "productId": 2, "quantity": 3 }');
  }

  wireText.innerHTML = lines.join('\n');
  wireText.classList.toggle('bad', activeKey.bad);
}

function renderChoices() {
  buildSegments(document.getElementById('keys'), KEYS, (item) => item === activeKey, (item) => {
    activeKey = item;
    renderChoices();
    renderWire();
    readAllowance();
  });
  buildSegments(document.getElementById('calls'), CALLS, (item) => item === activeCall, (item) => {
    activeCall = item;
    renderChoices();
    renderWire();
  });
}

function renderAllowance() {
  pipsBox.textContent = '';
  const shown = remaining === null ? 0 : remaining;
  for (let index = 0; index < limit; index++) {
    const pip = document.createElement('div');
    pip.className = index < shown ? 'pip full' : 'pip';
    pipsBox.appendChild(pip);
  }

  remainingOut.textContent = remaining === null ? 'n/a' : remaining;
  remainingOut.parentElement.classList.toggle('empty', remaining === 0);
  remainingOut.parentElement.classList.toggle('unknown', remaining === null);
  ofLimit.textContent = 'of ' + limit + (limit === 1 ? ' token left' : ' tokens left');

  const period = Math.round(windowSeconds / limit);
  rateNote.textContent = 'one token back every ' + period + 's';

  if (activeKey.bad) {
    nextToken.textContent = 'A wrong key never reaches the counter, so it has no bucket.';
  } else if (remaining === null) {
    nextToken.textContent = 'reading the gateway';
  } else if (remaining >= limit) {
    nextToken.textContent = 'Bucket is full. You can send ' + limit + ' straight away.';
  } else {
    const elapsed = Math.floor((Date.now() - lastChange.at) / 1000);
    const left = Math.max(0, period - elapsed);
    nextToken.textContent = 'Next token in about ' + left + 's.';
  }
}

function renderHistory() {
  if (!history.length) {
    ticksBox.innerHTML = '<span class="ticks-empty">Nothing sent yet.</span>';
    tallyOut.textContent = 'nothing yet';
    return;
  }

  ticksBox.textContent = '';
  history.slice(-60).forEach((status) => {
    const tick = document.createElement('div');
    tick.className = 'tick ' + classOf(status);
    ticksBox.appendChild(tick);
  });

  const through = history.filter((status) => status >= 200 && status < 300).length;
  tallyOut.textContent = through + ' of ' + history.length + ' got through';
}

function showAnswer(status, headers, text, ms) {
  const kind = classOf(status);
  answerPanel.classList.remove('pass', 'deny', 'turn');
  answerPanel.classList.add(kind);

  const known = REASONS[status] || ['', 'The gateway passed this answer back from the backend.'];
  codeOut.textContent = status;
  reasonOut.textContent = known[0];
  plainOut.textContent = known[1];
  timingOut.textContent = ms + ' ms round trip';

  document.getElementById('hLimit').textContent = headers.limit || 'not sent';
  document.getElementById('hRemaining').textContent = headers.remaining || 'not sent';
  document.getElementById('hRetry').textContent = headers.retry || 'not sent';

  try {
    bodyOut.textContent = JSON.stringify(JSON.parse(text), null, 2);
  } catch (error) {
    bodyOut.textContent = text || '(empty)';
  }

  if (status === 429 && headers.retry) {
    waitUntil = Date.now() + Number(headers.retry) * 1000;
    waitBox.hidden = false;
  } else if (status !== 429) {
    waitUntil = 0;
    waitBox.hidden = true;
  }
}

function payload() {
  return JSON.stringify({
    productId: Math.floor(Math.random() * 5) + 1,
    quantity: Math.floor(Math.random() * 3) + 1
  });
}

async function fire() {
  const options = {
    method: activeCall.method,
    cache: 'no-store',
    headers: { 'x-api-key': activeKey.key }
  };

  if (activeCall.method === 'POST') {
    options.headers['content-type'] = 'application/json';
    options.body = payload();
  }

  const startedAt = performance.now();
  const response = await fetch(base + activeCall.path, options);
  const text = await response.text();

  return {
    status: response.status,
    ms: Math.round(performance.now() - startedAt),
    text: text,
    headers: {
      limit: response.headers.get('X-RateLimit-Limit'),
      remaining: response.headers.get('X-RateLimit-Remaining'),
      retry: response.headers.get('Retry-After')
    }
  };
}

function setBusy(state) {
  busy = state;
  sendOne.disabled = state;
  sendTen.disabled = state;
}

async function sendBatch(count) {
  if (busy) return;
  setBusy(true);

  try {
    const results = await Promise.all(Array.from({ length: count }, fire));
    results.forEach((result) => history.push(result.status));

    const blocked = results.find((result) => result.status === 429);
    const shown = count === 1 ? results[0] : (blocked || results[results.length - 1]);
    showAnswer(shown.status, shown.headers, shown.text, shown.ms);

    if (count > 1) {
      const through = results.filter((result) => result.status < 300).length;
      plainOut.textContent = 'You fired ' + count + ' requests at the same moment. ' + through +
        ' got through and ' + (count - through) + ' were stopped. The limiter counts in Redis, so the number that passes is never more than the limit.';
    }

    renderHistory();
    await readAllowance();
  } catch (error) {
    answerPanel.classList.remove('pass', 'turn');
    answerPanel.classList.add('deny');
    codeOut.textContent = '--';
    reasonOut.textContent = 'No answer';
    plainOut.textContent = 'Nothing came back from ' + base + '. Check the address, and that both laptops are on the same network.';
    timingOut.textContent = '';
  }

  setBusy(false);
}

async function readAllowance() {
  if (activeKey.bad) {
    remaining = null;
    renderAllowance();
    return;
  }

  try {
    const response = await fetch(base + '/rate-limit', {
      cache: 'no-store',
      headers: { 'x-api-key': activeKey.key }
    });
    if (response.status !== 200) return;
    const data = await response.json();
    limit = data.limit;
    windowSeconds = data.windowSeconds;
    if (lastChange.value !== data.remaining) {
      lastChange = { value: data.remaining, at: Date.now() };
    }
    remaining = data.remaining;
    renderAllowance();
  } catch (error) {
    remaining = null;
  }
}

async function ping() {
  try {
    const response = await fetch(base + '/health', { cache: 'no-store' });
    lamp.classList.toggle('up', response.status === 200);
    linkState.textContent = response.status === 200 ? base : 'gateway is degraded';
  } catch (error) {
    lamp.classList.remove('up');
    linkState.textContent = 'cannot reach ' + base;
  }
}

function countdown() {
  if (!waitUntil) return;
  const left = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));
  waitN.textContent = left;
  if (left === 0) {
    waitUntil = 0;
    waitBox.hidden = true;
  }
}

sendOne.addEventListener('click', () => sendBatch(1));
sendTen.addEventListener('click', () => sendBatch(10));

document.getElementById('connect').addEventListener('click', () => {
  base = clean(baseInput.value);
  baseInput.value = base;
  store.setItem('gatewayBase', base);
  renderWire();
  ping();
  readAllowance();
});

renderChoices();
renderWire();
renderAllowance();
renderHistory();
ping();
readAllowance();
window.setInterval(ping, 3000);
window.setInterval(readAllowance, 1200);
window.setInterval(() => { countdown(); renderAllowance(); }, 500);
