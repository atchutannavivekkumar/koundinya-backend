# Koundinya Store — Order Email Backend

Sends an automatic confirmation email (to the customer, with a copy to you) the
moment an order is placed at checkout. Uses your Gmail account via SMTP.

## What you need
- Node.js 18 or newer installed (https://nodejs.org)
- A Gmail account with 2-Step Verification turned on

## 1. Get a Gmail App Password
A normal Gmail password won't work for sending; Google requires an "App Password".
1. Turn on 2-Step Verification: https://myaccount.google.com/security
2. Open https://myaccount.google.com/apppasswords
3. Create a password (name it "Koundinya Store"), copy the 16 characters.

## 2. Configure
In this `backend` folder:
1. Copy `.env.example` to a new file named `.env`
   (Note: files starting with a dot are hidden in Finder. If you can't see
   `.env.example`, use the included `env-template.txt` instead — same contents.
   In Finder press Cmd+Shift+. to show hidden files, or create `.env` from the
   terminal as shown below.)
2. Fill in:
   - `GMAIL_USER` — your Gmail address
   - `GMAIL_APP_PASSWORD` — the 16-character app password (no spaces)
   - `OWNER_EMAIL` — where you want order copies (can be the same Gmail)
   - `ALLOWED_ORIGIN` — your site's address (e.g. http://127.0.0.1:5500),
     or `*` while testing

## 3. Install and run
```bash
cd backend
npm install
```

Create your `.env` quickly from the terminal (avoids the hidden-file issue):
```bash
cat > .env << 'EOF'
GMAIL_USER=youraddress@gmail.com
GMAIL_APP_PASSWORD=your16charapppassword
OWNER_EMAIL=youraddress@gmail.com
STORE_NAME=Koundinya Constructions
PORT=3000
ALLOWED_ORIGIN=*
EOF
```
Then edit it with your real values: `open -e .env`

Start the server:
```bash
npm start
```
You should see: `✓ Gmail SMTP ready — emails will send from ...`
The server runs on http://localhost:3000

## 4. Point the website at the backend
The checkout page calls `http://localhost:3000` by default. If your backend runs
somewhere else (a server, a different port), add this line near the top of the
`<script>` in `checkout.html`, before it's used:

```html
<script>window.KC_API_BASE = "https://your-backend-url.com";</script>
```

## How it works
- Checkout collects the customer's email (new required field).
- After placing the order, the page POSTs the order to `/api/order-email`.
- The backend builds a branded HTML email and sends it via Gmail:
  one to the customer, one copy to the owner.
- If the backend is offline, the order is still placed locally and the customer
  sees a note; nothing breaks.

## Endpoints
- `POST /api/order-email` — body: `{ order, trackUrl }`. Sends the emails.
- `GET /health` — returns `{ ok: true }` for uptime checks.

## Security notes
- Never commit `.env` or share it — it contains your app password.
- For production, set `ALLOWED_ORIGIN` to your real domain (not `*`).
- Gmail sending limits apply (~500/day on free accounts). For higher volume,
  switch to a dedicated provider (SendGrid, Resend, AWS SES) — only the
  transporter setup in `server.js` would change.
