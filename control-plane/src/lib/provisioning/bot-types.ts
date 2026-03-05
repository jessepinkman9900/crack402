/**
 * Bot Type Definitions
 * Defines the different types of bots that can be deployed
 */

export type BotType = 'standard' | 'gateway';

export interface BotTypeConfig {
  type: BotType;
  name: string;
  description: string;
  serviceCommand: string; // Command used to start the bot as a service
  requiresChannel: boolean; // Whether this bot type requires channel configuration
  supportsGateway: boolean; // Whether this bot type supports gateway mode
}

export const BOT_TYPES: Record<BotType, BotTypeConfig> = {
  standard: {
    type: 'standard',
    name: 'Standard Bot',
    description: 'Channel-based bot (Telegram, Discord, Slack) using zeroclaw service',
    serviceCommand: 'zeroclaw service',
    requiresChannel: true,
    supportsGateway: false,
  },
  gateway: {
    type: 'gateway',
    name: 'Gateway Bot',
    description: 'Webhook-based bot with HTTP API using zeroclaw gateway',
    serviceCommand: 'zeroclaw gateway',
    requiresChannel: false,
    supportsGateway: true,
  },
};

export interface GatewayConfig {
  host: string;
  port: number;
  newPairing?: boolean;
}

export interface StandardChannelConfig {
  channelType: 'telegram' | 'discord' | 'slack';
  channelToken: string;
}

/**
 * Get bot type configuration
 */
export function getBotTypeConfig(type: BotType): BotTypeConfig {
  return BOT_TYPES[type];
}

/**
 * Validate bot configuration based on type
 */
export function validateBotConfig(
  type: BotType,
  config: StandardChannelConfig | GatewayConfig
): { valid: boolean; error?: string } {
  const botType = getBotTypeConfig(type);

  if (type === 'standard') {
    const channelConfig = config as StandardChannelConfig;
    if (!channelConfig.channelType) {
      return { valid: false, error: 'Channel type is required for standard bots' };
    }
    if (!channelConfig.channelToken) {
      return { valid: false, error: 'Channel token is required for standard bots' };
    }
  }

  if (type === 'gateway') {
    const gatewayConfig = config as GatewayConfig;
    if (!gatewayConfig.port) {
      return { valid: false, error: 'Port is required for gateway bots' };
    }
    if (gatewayConfig.port < 1024 || gatewayConfig.port > 65535) {
      return { valid: false, error: 'Port must be between 1024 and 65535' };
    }
  }

  return { valid: true };
}
