const express = require('express');

const app = express();
const port = process.env.API_PORT || 4000;

const products = [
  { id: 1, name: 'Wireless Mouse', price: 799, stock: 120 },
  { id: 2, name: 'Mechanical Keyboard', price: 3499, stock: 45 },
  { id: 3, name: 'USB-C Hub', price: 1899, stock: 60 },
  { id: 4, name: 'Laptop Stand', price: 1299, stock: 80 },
  { id: 5, name: 'Webcam', price: 2499, stock: 30 }
];

const orders = [];

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/products', (req, res) => {
  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const product = products.find((item) => item.id === Number(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

app.post('/api/orders', (req, res) => {
  const { productId, quantity } = req.body || {};
  const product = products.find((item) => item.id === productId);

  if (!product) {
    return res.status(400).json({ error: 'productId must be the id of an existing product' });
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'quantity must be a whole number of at least 1' });
  }

  const order = {
    id: orders.length + 1,
    productId: product.id,
    quantity: quantity,
    total: product.price * quantity,
    placedBy: req.header('x-client') || 'unknown',
    createdAt: new Date().toISOString()
  };
  orders.push(order);
  res.status(201).json(order);
});

app.get('/api/orders', (req, res) => {
  res.json(orders);
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(port, '127.0.0.1', () => {
  console.log('Sample API running on port ' + port);
});
