#!/bin/bash
# Paste this into EC2 -> Launch instance -> Advanced details -> "User data".
# On first boot it installs Node, downloads Gambit from GitHub and runs it on port 80
# as a service (auto-restarts, survives reboots). Progress log: /var/log/cloud-init-output.log
set -euxo pipefail

REPO_URL="https://github.com/envixyy/gambit-chess.git"

export DEBIAN_FRONTEND=noninteractive
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

cd /home/ubuntu
sudo -u ubuntu git clone "$REPO_URL" gambit-chess
cd gambit-chess
sudo -u ubuntu npm ci --omit=dev
sudo -u ubuntu mkdir -p /home/ubuntu/gambit-data

cat > /etc/systemd/system/gambit.service <<'UNIT'
[Unit]
Description=Gambit chess
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/gambit-chess
Environment=PORT=80
Environment=DATA_DIR=/home/ubuntu/gambit-data
ExecStart=/usr/bin/node server.js
Restart=always
# lets the non-root user listen on port 80
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now gambit
