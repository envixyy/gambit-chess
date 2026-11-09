# Putting Gambit online (GitHub + AWS)

Goal: your friend opens `https://your-domain` (or an IP) and plays. Takes about 20 minutes.

## 1. GitHub

1. On github.com click **New repository**, name it `gambit-chess`, leave it **empty** (no README), choose Private or Public.
2. In this project folder:

```bash
git init -b main
git add .
git commit -m "Gambit chess"
git remote add origin https://github.com/<your-username>/gambit-chess.git
git push -u origin main
```

Git for Windows opens a browser window to sign in the first time. Nothing secret is in the repo
(`data/`, `node_modules/` and `.env` are git-ignored).

If the repo is **private**, your friend only needs the game URL, not repo access.

## 2. AWS — Lightsail (simplest, ~$5/month, has a free trial)

Gambit keeps live games in memory, so run **one** server (do not put it behind an autoscaling group).
Lightsail is a plain virtual server, which is exactly right.

1. AWS Console → **Lightsail** → **Create instance** → Linux/Unix → **OS only → Ubuntu 22.04** → the $5 plan.
2. After it starts: **Networking** tab → add firewall rules for **HTTP (80)** and **HTTPS (443)**.
   Also click **Create static IP** and attach it, so the address never changes.
3. Click the orange **Connect using SSH** button, then run:

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# get the code (private repo: use a GitHub personal access token as the password)
git clone https://github.com/<your-username>/gambit-chess.git
cd gambit-chess && npm ci --omit=dev
```

4. Run it as a service so it survives crashes and reboots. Create `/etc/systemd/system/gambit.service`:

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

5. **HTTPS** (needed for the clipboard "Copy link" button and for friends' phones). Point a domain's
   A record at the static IP, then:

```bash
sudo apt-get install -y caddy
echo 'your-domain.com { reverse_proxy localhost:3000 }' | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Caddy gets and renews the certificate automatically and proxies WebSockets with no extra settings.
No domain? Skip step 5 and use `http://<static-ip>:3000` (open port 3000 in the firewall instead of 80/443).
Everything works over plain HTTP except the one-click copy button, which falls back automatically.

### Updating later

```bash
cd gambit-chess && git pull && npm ci --omit=dev && sudo systemctl restart gambit
```

(Restarting ends games in progress, so do it when nobody is playing. Ratings and history survive; they live in `DATA_DIR`.)

## Alternative: Docker on Lightsail Containers

A `Dockerfile` is included. Lightsail → **Containers** → create a service (Nano), push the image with the
Lightsail plugin, expose port 3000. You get a free `https://….amazonlightsail.com` address. Mount no
volume and ratings reset on every deploy, so the VM route above is better if you want ratings to stick.

## Costs & safety notes

- Lightsail Nano/Micro is a flat monthly price, so there are no surprise bills. Set an AWS budget alert anyway.
- Anyone with the link can play. There is no login, so don't put it somewhere you don't want strangers to find;
  keep "List in open games" off for private games.
- Never commit AWS keys or tokens. This project doesn't need any.
