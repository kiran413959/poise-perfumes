# Putting the POISE PERFUMES shop online

## How it runs
One small server runs everything. Customers see the storefront at your web address, and you use the admin at `your-address/admin/`.
Your products, orders and photos are saved as files (`db.json` and an `uploads` folder), so **the server must keep them on a permanent disk**. Hosting that wipes its disk on every update would erase your shop. Both routes below avoid this.

## Pick a route
- **Route A: Render (easier).** No server commands. About $7/month for the smallest always-on plan when I checked (2026), plus a small charge for the disk. Prices change, so check render.com/pricing.
- **Route B: your own small server (cheapest, most control).** A few dollars a month, but you type commands. Best if you have an IT person to help.

## Free hosting: the honest picture
Free hosting works for **trying the shop**, but is risky for a real business. What I found (July to August 2026; free plans change often, so check each site):
- **Render free plan:** public, but it falls asleep after 15 minutes without visitors and has no permanent disk, so your data would be lost. Fine for a demo only. Never use it for real orders.
- **Suga free plan:** an always-on container with 5 GB of storage, one project, no credit card mentioned. This is the best free candidate, but I could not confirm that the storage is permanent or what its terms say about shops. Check both before relying on it.
- **GoDaddy Node.js Hosting:** the free part is a private preview that needs a login to view. Making it public needs a paid GoDaddy hosting plan.
- **Vercel, Netlify, Cloudflare:** built for a different kind of app, and Vercel's free plan is for non-commercial use only. Not suitable.
- **Railway:** a one-time $5 credit that lasts about a month. **Fly.io:** no free plan for new accounts.

**If you try a free host (Suga or similar):**
1. Upload the project (it includes a `Dockerfile`) and add your settings as environment variables (see Route A, step 5; skip `DATA_DIR` unless you attach storage).
2. If the host lets you attach permanent storage, mount it (for example at `/data`) and set `DATA_DIR=/data`.
3. **Test that data survives:** add a test product, restart or redeploy the app, and check the product is still there. If it vanished, that host is not safe for real orders.
4. Download a backup from Admin (**Backup > Download backup**) at least once a week. To restore, put that file back as `db.json` in the data folder. Photos are not in the backup, so keep the originals.

For a real shop, a paid plan of around $3 to $7 a month is the safer choice.

## Route A: Render
1. **Put the files on GitHub.** Create a free account at github.com, make a new **private** repository, then use *Add file > Upload files* and upload everything in the `poise-shop` folder (keep the folders: `client`, `admin`, `server`, and `package.json` at the top). Do not upload `server/.env`, `server/data` or `server/uploads`.
2. **Create the service.** Sign up at render.com, choose *New > Web Service*, and connect that repository.
3. **Settings.** Runtime: Node. Start command: `npm start`. Choose a paid instance (disks are not available on free ones).
4. **Add a disk.** In the service, add a Disk with mount path `/var/data` and 1 GB to start.
5. **Add environment variables** (Environment tab):
   - `NODE_ENV` = `production`
   - `DATA_DIR` = `/var/data`
   - `ADMIN_PASSWORD` = a long password only you know
   - `PUBLIC_API_URL` and `STORE_URL` = your Render address (later your own domain)
   - Email lines (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `SHOP_EMAIL`) and the bank lines (`BML_*`, `MIB_*`) from `server/.env.example`, when you have them
6. **Deploy.** Open the address Render gives you. The admin is at `/admin/`.
7. **Your own domain.** Buy one from any registrar, add it under the service's *Custom Domains*, and add the DNS records Render shows you. Then change `PUBLIC_API_URL` and `STORE_URL` to the new address.

## Route B: your own server (Ubuntu)
1. Rent a small Ubuntu server from any provider. Note its IP address. At your domain registrar, point an **A record** for your domain to that IP.
2. Connect (`ssh root@YOUR_IP`) and install the tools:
   ```
   apt update && apt install -y curl caddy
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt install -y nodejs
   ```
3. Copy the `poise-shop` folder to `/opt/poise-shop` on the server (with an SFTP program such as FileZilla).
4. Create `/opt/poise-shop/server/.env` from `.env.example` and fill it in. Set `ADMIN_PASSWORD`, and set `PUBLIC_API_URL` and `STORE_URL` to `https://yourdomain.com`.
5. Make the server start by itself. Create `/etc/systemd/system/poise.service`:
   ```
   [Unit]
   Description=POISE shop
   After=network.target

   [Service]
   WorkingDirectory=/opt/poise-shop
   ExecStart=/usr/bin/node server/server.js
   Environment=NODE_ENV=production
   Environment=PORT=3000
   Restart=always
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```
   Then run:
   ```
   chown -R www-data /opt/poise-shop/server
   systemctl enable --now poise
   ```
6. Add the padlock (HTTPS). Put this in `/etc/caddy/Caddyfile`, then run `systemctl reload caddy`:
   ```
   yourdomain.com {
     reverse_proxy localhost:3000
   }
   ```

## Before you take real orders
- [ ] Strong `ADMIN_PASSWORD` set. The server refuses to start in production with the default one.
- [ ] `PUBLIC_API_URL` and `STORE_URL` set to your real `https://` address.
- [ ] Sample products deleted and real products added, with photos. USD rate checked.
- [ ] Payment settings filled in (cash on delivery, bank details).
- [ ] Test email sent from Admin.
- [ ] Card payments: tested with each bank's sandbox first. In the BML merchant portal, set the webhook address to `https://yourdomain.com/api/pay/bml-webhook`, then switch `BML_ENV` to `live` only after testing.
- [ ] A test order placed for each payment method you offer.
- [ ] Your phone, email and address added to the footer (in `client/index.html`).
- [ ] Privacy policy and returns policy written. They are not included.

## Backups (important)
Copy `db.json` and the `uploads` folder somewhere safe every day, and keep a copy away from the server.
- Route A: if Render offers disk snapshots or backups on your plan, turn them on, and also download a copy regularly.
- Route B example, daily at 3am (run `crontab -e`):
  ```
  0 3 * * * tar czf /root/backup-$(date +\%F).tgz -C /opt/poise-shop/server data uploads
  ```

## Updating the shop later
Replace the program files with the new version, but **keep** your data (`server/data` and `server/uploads`, or your disk), then restart (Render redeploys by itself).

## Good to know
- This is built for a small shop. If you grow a lot, the data should move into a proper database.
- Admin sign-in locks for 15 minutes after 8 wrong passwords.
