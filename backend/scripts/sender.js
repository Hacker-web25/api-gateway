const gatewayUrl = process.argv[2] || 'http://127.0.0.1:3000';
const apiKey = process.argv[3] || 'demo-key-1';
const count = Number(process.argv[4]) || 8;
const pauseMs = Number(process.argv[5]) || 300;

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendOrder(number) {
  const order = { productId: (number % 5) + 1, quantity: number };

  const response = await fetch(gatewayUrl + '/api/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify(order)
  });

  const remaining = response.headers.get('x-ratelimit-remaining');
  const retryAfter = response.headers.get('retry-after');

  let note = 'tokens left: ' + remaining;
  if (response.status === 429) {
    note = 'blocked, retry after ' + retryAfter + 's';
  }
  if (response.status === 401) {
    note = 'invalid API key';
  }

  console.log('request ' + number + '  status ' + response.status + '  ' + note);
}

async function run() {
  console.log('Sending ' + count + ' orders to ' + gatewayUrl);

  for (let number = 1; number <= count; number++) {
    try {
      await sendOrder(number);
    } catch (error) {
      console.log('request ' + number + '  failed: ' + error.message);
    }
    await pause(pauseMs);
  }
}

run();
