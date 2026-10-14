# POISE PERFUMES shop

Three separate parts that work together:

- `server/`  the API and database (server side). Run: `node server/server.js` (Node 18+, nothing to install)
- `client/`  the public storefront (client side)
- `admin/`   the dashboard where you manage products, brands, orders and the USD rate

## Run it
    node server/server.js
Storefront: http://localhost:3000/   Admin: http://localhost:3000/admin/  (default password: poise123)

## Putting it online
See `HOSTING.md` for step-by-step instructions (including what free hosting can and cannot do, Render, or your own server). A `Dockerfile` is included for container hosts. On a host with a permanent disk, set `DATA_DIR` to the disk's folder so your data survives updates.

## Before going live
- Set a strong password: `ADMIN_PASSWORD=yourpassword node server/server.js`
- Host `client/` and `admin/` anywhere (static hosting), host `server/` on a Node host, then put the server address in both `config.js` files and set `ALLOWED_ORIGIN` on the server.
- Data is saved in `server/data/db.json`. Back it up.
- Product photos are saved in `server/uploads/` (back it up with `server/data/`).
- Payments: cash on delivery and bank transfer are set in Admin > Payment settings.
- Card payments: copy `server/.env.example` to `server/.env` and fill in the keys. Bank of Maldives (BML Connect) and MIB Global Pay each switch on by themselves once their keys are present, and then appear at checkout. Set the BML webhook address in the BML merchant portal to `<PUBLIC_API_URL>/api/pay/bml-webhook`. Test with each bank's sandbox first.
- Cancelled or failed card payments put the stock back. A card order that is never completed stays 'Pending card payment' until you cancel it in Admin.
- Order emails: fill in the SMTP lines in `server/.env`. Customers get an email when they order, when payment is received, when the order ships and if it is cancelled; you get a new-order alert at `SHOP_EMAIL`. Use Admin > Payment settings > Send test email to check it works. Guests can enter an email at checkout; signed-in customers use their account email.
