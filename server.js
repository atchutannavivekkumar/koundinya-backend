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
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

const {
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  OWNER_EMAIL,
  STORE_NAME = 'Koundinya Constructions',
  PORT = 3000,
} = process.env;

// ── Gmail transporter ───────────────────────────────────────────────────────
// Gmail requires an "App Password" (with 2-Step Verification on), not your
// normal password. See .env.example for how to create one.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

// Verify credentials on boot so problems show up immediately, not on first order.
transporter.verify()
  .then(() => console.log('✓ Gmail SMTP ready — emails will send from', GMAIL_USER))
  .catch(err => {
    console.error('✗ Gmail SMTP not ready. Check GMAIL_USER / GMAIL_APP_PASSWORD in .env');
    console.error('  ', err.message);
  });

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
    await transporter.sendMail({
      from: `"${STORE_NAME}" <${GMAIL_USER}>`,
      to: order.customer.email,
      subject,
      text,        // plain-text part — helps avoid spam folders
      html,
      replyTo: OWNER_EMAIL || GMAIL_USER,
      headers: { 'X-Entity-Ref-ID': order.id },
    });

    // 2) a copy to the owner (best-effort; don't fail the request if this one errors)
    if (OWNER_EMAIL) {
      transporter.sendMail({
        from: `"${STORE_NAME} Orders" <${GMAIL_USER}>`,
        to: OWNER_EMAIL,
        subject: `New order ${order.id} — ${order.customer.name}`,
        text,
        html,
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
