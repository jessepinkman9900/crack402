/**
 * Cloud-init template for ZeroClaw bot provisioning
 * Generates user-data scripts for AWS EC2 and Hetzner VM initialization
 *
 * Supports two bot types:
 * - standard: Channel-based bots (Telegram, Discord, Slack) using zeroclaw service
 * - gateway: Webhook-based bots with HTTP API using zeroclaw gateway
 */

import type { BotType, GatewayConfig } from './bot-types';

export interface CloudInitVars {
  botType: BotType;
  botName: string;

  // Credentials (injected as environment variables)
  openrouterKey: string;

  // Standard bot configuration (optional, required for standard type)
  channelType?: string;
  channelToken?: string;
  channelConfig?: Record<string, any>;

  // Gateway bot configuration (optional, required for gateway type)
  gatewayConfig?: GatewayConfig;

  // SSH access
  sshPublicKey: string; // User's SSH public key for debugging
}

/**
 * Generate cloud-init user-data script for ZeroClaw deployment
 */
// export function generateCloudInit(vars: CloudInitVars): string {
//   const channelConfigJson = vars.channelConfig ? JSON.stringify(vars.channelConfig) : '{}';

/**
 * Generate cloud-init user-data script for ZeroClaw deployment
 */
export function generateCloudInit(vars: CloudInitVars): string {
  const channelConfigJson = vars.channelConfig ? JSON.stringify(vars.channelConfig) : '{}';
  const gatewayPort = vars.gatewayConfig?.port || 3000;
  const gatewayHost = vars.gatewayConfig?.host || '0.0.0.0';
  const newPairing = vars.gatewayConfig?.newPairing ? '--new-pairing' : '';

  return `#!/bin/bash
set -euo pipefail

# === Configuration (injected as environment variables) ===
export ZEROCLAW_OPENROUTER_KEY="${vars.openrouterKey}"
export ZEROCLAW_BOT_TYPE="${vars.botType}"
export ZEROCLAW_BOT_NAME="${vars.botName}"
${vars.channelType ? `export ZEROCLAW_CHANNEL_TYPE="${vars.channelType}"` : ''}
${vars.channelToken ? `export ZEROCLAW_CHANNEL_TOKEN="${vars.channelToken}"` : ''}
${vars.botType === 'gateway' ? `export ZEROCLAW_GATEWAY_PORT="${gatewayPort}"` : ''}
${vars.botType === 'gateway' ? `export ZEROCLAW_GATEWAY_HOST="${gatewayHost}"` : ''}

# === Logging Setup ===
exec > >(tee /var/log/zeroclaw-bootstrap.log)
exec 2>&1
echo "[$(date)] Starting Zeroclaw bootstrap for bot: $ZEROCLAW_BOT_NAME (type: $ZEROCLAW_BOT_TYPE)"

# === SSH Key Setup ===
echo "[$(date)] Setting up SSH access..."
mkdir -p /root/.ssh
chmod 700 /root/.ssh
echo "${vars.sshPublicKey}" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
echo "[$(date)] SSH access configured"

# === System Dependencies ===
echo "[$(date)] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq git curl build-essential pkg-config libssl-dev

# === Rust Installation ===
echo "[$(date)] Installing Rust toolchain..."
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env
echo 'export PATH="/root/.cargo/bin:$PATH"' >> ~/.bashrc

# === Zeroclaw Installation ===
echo "[$(date)] Cloning Zeroclaw repository..."
REPO_DIR="/opt/zeroclaw"
git clone https://github.com/zeroclaw-labs/zeroclaw.git $REPO_DIR
cd $REPO_DIR

echo "[$(date)] Installing Zeroclaw system dependencies..."
./bootstrap.sh --install-system-deps

echo "[$(date)] Installing Zeroclaw prebuilt binary..."
./bootstrap.sh --prebuilt-only

# Add cargo bin to PATH for this session
export PATH="/root/.cargo/bin:$PATH"

# === Onboarding ===
echo "[$(date)] Running Zeroclaw onboarding..."
zeroclaw onboard \\
  --api-key "$ZEROCLAW_OPENROUTER_KEY" \\
  --provider openrouter \\
  --model "openrouter/auto" \\
  --memory sqlite \\
  --force

# === Bot Type-Specific Setup ===
if [ "$ZEROCLAW_BOT_TYPE" = "standard" ]; then
  echo "[$(date)] Setting up standard channel bot ($ZEROCLAW_CHANNEL_TYPE)..."

  # Add channel configuration
  zeroclaw channel add "$ZEROCLAW_CHANNEL_TYPE" '${channelConfigJson}'

  # Install and start as systemd service
  echo "[$(date)] Installing Zeroclaw service..."
  zeroclaw service install
  zeroclaw service start

  # Wait for service to be ready
  sleep 5

  # Verify service status
  echo "[$(date)] Verifying service status..."
  zeroclaw service status

elif [ "$ZEROCLAW_BOT_TYPE" = "gateway" ]; then
  echo "[$(date)] Setting up gateway bot..."

  # Create systemd service for gateway
  cat > /etc/systemd/system/zeroclaw-gateway.service <<'EOF'
[Unit]
Description=Zeroclaw Gateway Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
Environment="PATH=/root/.cargo/bin:/usr/local/bin:/usr/bin:/bin"
Environment="ZEROCLAW_OPENROUTER_KEY=${vars.openrouterKey}"
ExecStart=/root/.cargo/bin/zeroclaw gateway --host ${gatewayHost} --port ${gatewayPort} ${newPairing}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  # Start gateway service
  echo "[$(date)] Starting gateway service..."
  systemctl daemon-reload
  systemctl enable zeroclaw-gateway.service
  systemctl start zeroclaw-gateway.service

  # Wait for service to be ready
  sleep 5

  # Verify service status
  echo "[$(date)] Verifying gateway service status..."
  systemctl status zeroclaw-gateway.service --no-pager
fi

echo "[$(date)] Bootstrap complete! Bot '$ZEROCLAW_BOT_NAME' is running."
echo "[$(date)] Bot type: $ZEROCLAW_BOT_TYPE"
echo "[$(date)] Logs available at: /var/log/zeroclaw-bootstrap.log"

# Mark bootstrap as successful
touch /var/lib/zeroclaw-bootstrap-complete
`;
}

/**
 * Default channel configurations for supported providers
 */
export const DEFAULT_CHANNEL_CONFIGS: Record<string, (botName: string, token: string) => Record<string, any>> = {
  telegram: (botName, token) => ({
    bot_token: token,
    name: botName,
  }),
  discord: (botName, token) => ({
    bot_token: token,
    name: botName,
  }),
  slack: (botName, token) => ({
    bot_token: token,
    name: botName,
  }),
};

/**
 * Generate channel config for a specific provider
 */
export function generateChannelConfig(
  provider: string,
  botName: string,
  token: string
): Record<string, any> {
  const generator = DEFAULT_CHANNEL_CONFIGS[provider];
  if (!generator) {
    throw new Error(`Unsupported channel provider: ${provider}`);
  }
  return generator(botName, token);
}
