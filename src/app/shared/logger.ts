import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'DISCORD_BOT_TOKEN',
      'EBAY_CLIENT_SECRET',
      '*.token',
      'error.config.headers.authorization',
      'error.config.headers.Authorization',
      'error.request.headers.authorization',
      'error.response.config.headers.authorization',
      'error.response.config.headers.Authorization',
    ],
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true },
        },
});
