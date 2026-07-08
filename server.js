// ============================================================================
//  Koundinya Constructions — order email backend
//  Sends an automatic confirmation email (to the customer + a copy to the
//  owner) the moment an order is placed. Uses Gmail SMTP via Nodemailer.
//
//  Run:  npm install   then   npm start
// ============================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

const {
  OWNER_EMAIL,
  STORE_NAME = 'Koundinya Constructions',
  PORT = 3000,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  MONGODB_URI,
  ADMIN_PASSCODE = 'koundinya',
  BREVO_API_KEY,
  SENDER_EMAIL,   // a verified sender address in your Brevo account
} = process.env;

// ── MongoDB ─────────────────────────────────────────────────────────────────
// Stores all orders in one place so the admin sees every order from every
// device. If MONGODB_URI isn't set, the server still runs (email-only mode)
// but order storage/listing endpoints return an error.
let ordersCol = null;
let productsCol = null;
let metaCol = null; // stores the category list
if (MONGODB_URI) {
  const mongo = new MongoClient(MONGODB_URI);
  mongo.connect()
    .then(() => {
      const db = mongo.db('koundinya');
      ordersCol = db.collection('orders');
      productsCol = db.collection('products');
      metaCol = db.collection('meta');
      console.log('✓ MongoDB connected — orders & catalogue will be saved');
    })
    .catch(err => console.error('✗ MongoDB connection failed:', err.message));
} else {
  console.log('• MongoDB not configured (set MONGODB_URI to save data server-side)');
}

// Fulfilment stages (kept in sync with the website)
const STAGES = ['Placed', 'Confirmed', 'Dispatched', 'Out for delivery', 'Delivered'];

// Simple owner check for admin endpoints (passcode sent in a header)
function isOwner(req) {
  return (req.headers['x-admin-passcode'] || '') === ADMIN_PASSCODE;
}

// ── Razorpay client ─────────────────────────────────────────────────────────
// Only created if keys are present, so the email features still work without
// payment configured. Keys come from the Razorpay dashboard (test or live).
let razorpay = null;
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
  console.log('✓ Razorpay ready —', RAZORPAY_KEY_ID.startsWith('rzp_live') ? 'LIVE mode' : 'TEST mode');
} else {
  console.log('• Razorpay not configured (set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to enable online payments)');
}

// ── Email via Brevo API (HTTPS) ─────────────────────────────────────────────
// We send through Brevo's HTTP API instead of SMTP, because many free hosts
// (e.g. Render free tier) block outbound SMTP ports. HTTPS is never blocked.
// Get a free API key at brevo.com → Settings → SMTP & API → API Keys, and
// verify your sender address under Senders.
const EMAIL_READY = Boolean(BREVO_API_KEY && SENDER_EMAIL);
if (EMAIL_READY) {
  console.log('✓ Brevo email ready — sending from', SENDER_EMAIL);
} else {
  console.log('✗ Email not configured. Set BREVO_API_KEY and SENDER_EMAIL to enable emails.');
}

// Sends one email through Brevo. Returns true on success.
async function sendEmail({ to, subject, html, text, replyTo, senderName }) {
  if (!EMAIL_READY) throw new Error('Email not configured');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: senderName || STORE_NAME, email: SENDER_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${detail.slice(0, 200)}`);
  }
  return true;
}

// ── helpers ─────────────────────────────────────────────────────────────────
const rupee = n => '₹' + Number(n || 0).toLocaleString('en-IN');

// Escape user-supplied text before putting it into HTML (prevents broken/unsafe markup)
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Validate the incoming order so we don't email on garbage input
function validateOrder(o) {
  if (!o || typeof o !== 'object') return 'Missing order';
  if (!o.id) return 'Missing order id';
  if (!o.customer || !o.customer.email) return 'Missing customer email';
  const email = String(o.customer.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email address';
  if (!Array.isArray(o.items) || o.items.length === 0) return 'Order has no items';
  return null;
}

// Build the HTML body of the confirmation email
function buildEmailHtml(order, trackUrl) {
  const c = order.customer;
  const rows = order.items.map(i => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">${esc(i.name)}
        <span style="color:#888;">× ${esc(i.qty)}</span></td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">
        ${rupee(i.price * i.qty)}</td>
    </tr>`).join('');

  const trackBtn = trackUrl ? `
    <tr><td colspan="2" style="padding-top:24px;">
      <a href="${esc(trackUrl)}" style="display:inline-block;background:#009688;color:#fff;
         text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;">
        Track your order</a>
    </td></tr>` : '';

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#14181b;">
    <div style="background:#14181b;color:#fff;padding:22px 24px;border-bottom:3px solid #009688;">
      <div style="font-size:20px;font-weight:bold;">${esc(STORE_NAME)}</div>
      <div style="font-size:12px;letter-spacing:.12em;color:#9aa6ad;text-transform:uppercase;">
        Construction Materials</div>
    </div>
    <div style="padding:24px;">
      <h2 style="margin:0 0 4px;">Thank you for your order</h2>
      <p style="color:#555;margin:0 0 18px;">Order <b>${esc(order.id)}</b> has been received.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${rows}
        <tr><td style="padding:8px 0;color:#888;">Subtotal</td>
            <td style="padding:8px 0;text-align:right;">${rupee(order.subtotal)}</td></tr>
        <tr><td style="padding:8px 0;color:#888;">Delivery</td>
            <td style="padding:8px 0;text-align:right;">${rupee(order.delivery)}</td></tr>
        <tr><td style="padding:12px 0;font-weight:bold;font-size:16px;border-top:2px solid #14181b;">Total</td>
            <td style="padding:12px 0;text-align:right;font-weight:bold;font-size:16px;border-top:2px solid #14181b;">
              ${rupee(order.total)}</td></tr>
        ${trackBtn}
      </table>
      <div style="margin-top:24px;padding-top:18px;border-top:1px solid #eee;font-size:13px;color:#555;">
        <b>Delivering to</b><br>
        ${esc(c.name)}<br>${esc(c.phone)}<br>
        ${esc(c.address)}${c.city ? ', ' + esc(c.city) : ''}${c.pin ? ' — ' + esc(c.pin) : ''}<br>
        <span style="color:#888;">Payment: ${esc(c.payment || 'N/A')}</span>
      </div>
    </div>
    <div style="padding:16px 24px;color:#999;font-size:12px;background:#f4f6f7;">
      Questions? Just reply to this email.
    </div>
  </div>`;
}

// Plain-text version of the email. Sending text alongside HTML is a strong
// signal to spam filters that the message is legitimate.
function buildEmailText(order, trackUrl) {
  const c = order.customer;
  const lines = order.items.map(i => `- ${i.qty} x ${i.name}: ${rupee(i.price * i.qty)}`).join('\n');
  return [
    `${STORE_NAME}`,
    `Thank you for your order.`,
    ``,
    `Order ${order.id}`,
    ``,
    lines,
    ``,
    `Subtotal: ${rupee(order.subtotal)}`,
    `Delivery: ${rupee(order.delivery)}`,
    `Total: ${rupee(order.total)}`,
    `Payment: ${c.payment || 'N/A'}`,
    ``,
    `Delivering to:`,
    `${c.name}, ${c.phone}`,
    `${c.address}${c.city ? ', ' + c.city : ''}${c.pin ? ' - ' + c.pin : ''}`,
    trackUrl ? `\nTrack your order: ${trackUrl}` : ``,
    ``,
    `Questions? Just reply to this email.`,
  ].join('\n');
}

// ── routes ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── catalogue: list products (public) ───────────────────────────────────────
// If the products collection is empty, the site seeds it from data.js on the
// client the first time; here we just return whatever is stored.
app.get('/api/products', async (_req, res) => {
  if (!productsCol) return res.status(503).json({ ok: false, error: 'Catalogue storage not configured' });
  try {
    const products = await productsCol.find({}).toArray();
    products.forEach(p => delete p._id);
    res.json({ ok: true, products });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not load products' });
  }
});

// ── catalogue: seed products (owner) — used once to import data.js ──────────
app.post('/api/products/seed', async (req, res) => {
  if (!productsCol) return res.status(503).json({ ok: false, error: 'Catalogue storage not configured' });
  if (!isOwner(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const items = Array.isArray(req.body.products) ? req.body.products : [];
  try {
    const count = await productsCol.countDocuments();
    if (count > 0) return res.json({ ok: true, seeded: false, message: 'Products already exist' });
    if (items.length) await productsCol.insertMany(items.map(p => ({ ...p })));
    res.json({ ok: true, seeded: true, inserted: items.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Seed failed' });
  }
});

// ── catalogue: add/update a product (owner) ─────────────────────────────────
app.put('/api/products/:id', async (req, res) => {
  if (!productsCol) return res.status(503).json({ ok: false, error: 'Catalogue storage not configured' });
  if (!isOwner(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const id = String(req.params.id);
  const product = { ...req.body.product, id };
  try {
    await productsCol.updateOne({ id }, { $set: product }, { upsert: true });
    res.json({ ok: true, product });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not save product' });
  }
});

// ── catalogue: delete a product (owner) ─────────────────────────────────────
app.delete('/api/products/:id', async (req, res) => {
  if (!productsCol) return res.status(503).json({ ok: false, error: 'Catalogue storage not configured' });
  if (!isOwner(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    await productsCol.deleteOne({ id: String(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not delete product' });
  }
});

// ── categories: get + set the ordered category list ─────────────────────────
app.get('/api/categories', async (_req, res) => {
  if (!metaCol) return res.status(503).json({ ok: false, error: 'Storage not configured' });
  try {
    const doc = await metaCol.findOne({ _id: 'categories' });
    res.json({ ok: true, categories: (doc && doc.list) || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not load categories' });
  }
});
app.put('/api/categories', async (req, res) => {
  if (!metaCol) return res.status(503).json({ ok: false, error: 'Storage not configured' });
  if (!isOwner(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const list = Array.isArray(req.body.categories) ? req.body.categories : [];
  try {
    await metaCol.updateOne({ _id: 'categories' }, { $set: { list } }, { upsert: true });
    res.json({ ok: true, categories: list });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not save categories' });
  }
});

// ── orders: create (called at checkout) ─────────────────────────────────────
// Generates the order number server-side and saves the order. Returns the
// saved order (with its id) so the website can show + track it.
app.post('/api/orders', async (req, res) => {
  if (!ordersCol) return res.status(503).json({ ok: false, error: 'Order storage not configured' });
  const { customer, items, delivery = 250 } = req.body || {};
  if (!customer || !customer.name || !customer.phone) {
    return res.status(400).json({ ok: false, error: 'Missing customer details' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Order has no items' });
  }
  try {
    const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
    const count = await ordersCol.countDocuments();
    const order = {
      id: 'KC-' + (1001 + count),
      placedAt: new Date().toISOString(),
      customer,
      items,
      subtotal,
      delivery,
      total: subtotal + delivery,
      stage: 'Placed',
      history: [{ stage: 'Placed', at: new Date().toISOString() }],
    };
    await ordersCol.insertOne(order);
    res.json({ ok: true, order });
  } catch (err) {
    console.error('✗ create order failed:', err.message);
    res.status(500).json({ ok: false, error: 'Could not save order' });
  }
});

// ── orders: track one (customer: order id + phone must match) ────────────────
app.get('/api/orders/track', async (req, res) => {
  if (!ordersCol) return res.status(503).json({ ok: false, error: 'Order storage not configured' });
  const id = String(req.query.id || '').trim().toUpperCase();
  const phone = String(req.query.phone || '').replace(/\D/g, '');
  if (!id || !phone) return res.status(400).json({ ok: false, error: 'Order number and phone required' });
  try {
    const order = await ordersCol.findOne({ id });
    const onFile = order ? String(order.customer.phone || '').replace(/\D/g, '') : '';
    // Same neutral message whether missing or phone mismatch (privacy).
    if (!order || onFile !== phone) {
      return res.status(404).json({ ok: false, error: 'No matching order' });
    }
    delete order._id;
    res.json({ ok: true, order });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Lookup failed' });
  }
});

// ── orders: list all (owner only) ───────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  if (!ordersCol) return res.status(503).json({ ok: false, error: 'Order storage not configured' });
  if (!isOwner(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    const orders = await ordersCol.find({}).sort({ placedAt: -1 }).limit(500).toArray();
    orders.forEach(o => delete o._id);
    res.json({ ok: true, orders });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not list orders' });
  }
});

// ── orders: update status (owner only) ──────────────────────────────────────
app.patch('/api/orders/:id', async (req, res) => {
  if (!ordersCol) return res.status(503).json({ ok: false, error: 'Order storage not configured' });
  if (!isOwner(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const id = String(req.params.id).toUpperCase();
  const stage = String(req.body.stage || '');
  if (!STAGES.includes(stage)) return res.status(400).json({ ok: false, error: 'Invalid stage' });
  try {
    const r = await ordersCol.findOneAndUpdate(
      { id },
      { $set: { stage }, $push: { history: { stage, at: new Date().toISOString() } } },
      { returnDocument: 'after' }
    );
    const updated = r.value || r; // driver version differences
    if (!updated) return res.status(404).json({ ok: false, error: 'Order not found' });
    if (updated._id) delete updated._id;
    res.json({ ok: true, order: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not update order' });
  }
});

// ── payment: create a Razorpay order ────────────────────────────────────────
// The browser sends the amount; we create a Razorpay order server-side and
// return its id plus the public key id. (In production, recompute the amount
// from the cart server-side rather than trusting the client.)
app.post('/api/payment/create-order', async (req, res) => {
  if (!razorpay) return res.status(503).json({ ok: false, error: 'Payments not configured' });
  const amount = Math.round(Number(req.body.amount));
  if (!amount || amount < 1) return res.status(400).json({ ok: false, error: 'Invalid amount' });
  try {
    const order = await razorpay.orders.create({
      amount: amount * 100,          // Razorpay works in paise
      currency: 'INR',
      receipt: 'rcpt_' + Date.now(),
      notes: { customer: req.body.customer?.name || '', phone: req.body.customer?.phone || '' },
    });
    res.json({ ok: true, order, keyId: RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('✗ create-order failed:', err.message);
    res.status(502).json({ ok: false, error: 'Could not start payment' });
  }
});

// ── payment: verify the signature after payment ─────────────────────────────
// Razorpay signs (order_id|payment_id) with your secret. We recompute it and
// compare — this proves the payment is genuine and wasn't faked by the browser.
app.post('/api/payment/verify', (req, res) => {
  if (!razorpay) return res.status(503).json({ ok: false, error: 'Payments not configured' });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ ok: false, error: 'Missing payment fields' });
  }
  const expected = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  if (expected === razorpay_signature) {
    console.log('✓ Payment verified:', razorpay_payment_id);
    res.json({ ok: true });
  } else {
    console.warn('✗ Payment signature mismatch for', razorpay_payment_id);
    res.status(400).json({ ok: false, error: 'Signature verification failed' });
  }
});

app.post('/api/order-email', async (req, res) => {
  const order = req.body.order;
  const trackUrl = req.body.trackUrl || '';

  const error = validateOrder(order);
  if (error) return res.status(400).json({ ok: false, error });

  const html = buildEmailHtml(order, trackUrl);
  const text = buildEmailText(order, trackUrl);
  const subject = `Your ${STORE_NAME} order ${order.id}`;

  try {
    // 1) confirmation to the customer
    await sendEmail({
      to: order.customer.email,
      subject,
      html,
      text,
      replyTo: OWNER_EMAIL || SENDER_EMAIL,
    });

    // 2) a copy to the owner (best-effort; don't fail the request if this one errors)
    if (OWNER_EMAIL) {
      sendEmail({
        to: OWNER_EMAIL,
        subject: `New order ${order.id} — ${order.customer.name}`,
        html,
        text,
        senderName: `${STORE_NAME} Orders`,
      }).catch(e => console.error('Owner copy failed:', e.message));
    }

    console.log(`✓ Sent confirmation for ${order.id} to ${order.customer.email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('✗ Email send failed:', err.message);
    res.status(502).json({ ok: false, error: 'Email could not be sent' });
  }
});

app.listen(PORT, () => console.log(`Koundinya email backend running on port ${PORT}`));
