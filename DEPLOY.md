# Putting Gambit online (GitHub + AWS free plan)

Goal: your friend opens `https://your-domain` (or an IP address) and plays. Takes about 20 minutes.

## 1. GitHub

1. On github.com click **New repository**, name it `gambit-chess`, leave it **empty** (no README), choose Private or Public.
2. In this project folder (the first commit already exists):

```bash
git remote add origin https://github.com/<your-username>/gambit-chess.git
git push -u origin main
```

Git for Windows opens a browser window to sign in the first time. Nothing secret is in the repo
(`data/`, `node_modules/` and `.env` are git-ignored).

If the repo is **private**, your friend only needs the game URL, not repo access.

## 2. AWS — free plan with one EC2 server

How AWS's free tier works for **new** accounts (as of this writing; check <https://aws.amazon.com/free/>):
you get about $100 of credits at sign-up (up to $100 more for trying services), valid for **6 months**.
You pick the **Free plan** while signing up, which can't bill you; when the credits or 6 months run out the
account closes unless you upgrade. Accounts created before July 2025 have the older 12-month t2/t3.micro allowance.

Gambit keeps live games in memory, so run **one** server (no autoscaling, no load balancer).
A single small EC2 instance is exactly right.

1. Sign up at aws.amazon.com and choose the **Free plan**. (You need a card for verification; nothing is charged on the Free plan.)
2. Console → **EC2** → **Launch instance**:
   - **Name:** `gambit`
   - **Image:** Ubuntu Server 24.04 LTS
   - **Instance type:** `t3.micro` (labelled *Free tier eligible*)
   - **Key pair:** *Proceed without a key pair* is fine; you'll connect from the browser
   - **Network settings → Edit:** create a security group that allows **SSH (22)**, **HTTP (80)** and **HTTPS (443)** from anywhere.
     No domain? Also add a **Custom TCP 3000** rule.
   - **Storage:** leave the default 8 GB
3. After it's running: **Elastic IPs** → *Allocate* → *Associate* with the instance, so the address survives stop/start.
   (Public IPv4 addresses cost a few cents per hour; on the Free plan that comes out of your credits.)
4. Select the instance → **Connect** → **EC2 Instance Connect** → *Connect*. A terminal opens in your browser. Run:

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# get the code (private repo: use a GitHub personal access token as the password)
git clone https://github.com/<your-username>/gambit-chess.git
cd gambit-chess && npm ci --omit=dev
```

5. Run it as a service so it survives crashes and reboots. Create `/etc/systemd/system/gambit.service`
   (`sudo nano /etc/systemd/system/gambit.service`):

```ini
[Unit]
Description=Gambit chess
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/gambit-chess
Environment=PORT=3000
Environment=DATA_DIR=/home/ubuntu/gambit-data
ExecStart=/usr/bin/node server.js
Restart=always
User=ubuntu

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now gambit
```

6. **HTTPS** (recommended; needed for the one-click "Copy link" button and nicer for phones). Point a domain's
   A record at the Elastic IP, then:

```bash
sudo apt-get install -y caddy
echo 'your-domain.com { reverse_proxy localhost:3000 }' | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Caddy gets and renews the certificate automatically and proxies WebSockets with no extra settings.
**No domain?** Skip step 6 and share `http://<elastic-ip>:3000`. Everything works over plain HTTP; the Copy button
falls back automatically.

### Updating later

```bash
cd gambit-chess && git pull && npm ci --omit=dev && sudo systemctl restart gambit
```

(Restarting ends games in progress, so do it when nobody is playing. Ratings and history survive; they live in `DATA_DIR`.)

## Staying inside the free plan

- Create a **budget alert** (Billing → Budgets) so you hear about any spend.
- Leave the plan on **Free** (don't upgrade to Paid) and AWS won't charge you; it closes the account at 6 months instead.
- Keep exactly one instance, one Elastic IP, and the default 8 GB disk.
- When the 6 months are up, either upgrade (a t3.micro is roughly $8–10/month) or move the same repo to any other host.
  The Dockerfile in this repo works on Fly.io, Render, Railway, etc.

## Safety notes

- Anyone with the link can play. There is no login, so don't post it publicly; keep "List in open games" off for private games.
- Never commit AWS keys or tokens. This project doesn't need any.
