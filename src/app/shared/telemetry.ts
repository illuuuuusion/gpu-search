import { metrics, trace, SpanStatusCode } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { env } from '../env/index.js';
import { logger } from './logger.js';

// Prometheus-Pull: startet einen lokalen /metrics-HTTP-Endpunkt. Nur aktiv,
// wenn OTEL_ENABLED=true (Default false -> keine offenen Ports in Tests/Dev).
// Init in try/catch: Telemetrie darf den Bot-Start nie verhindern (A3).
if (env.OTEL_ENABLED) {
  try {
    const sdk = new NodeSDK({
      metricReaders: [new PrometheusExporter({ port: env.OTEL_PROMETHEUS_PORT })],
    });
    sdk.start();
    logger.info(
      { port: env.OTEL_PROMETHEUS_PORT, path: '/metrics' },
      'telemetry enabled (prometheus pull endpoint)',
    );
  } catch (error) {
    logger.error({ error }, 'failed to start telemetry; continuing without metrics');
  }
}

const tracer = trace.getTracer('gpu-search');
const meter = metrics.getMeter('gpu-search');

// Instrumente sind vor SDK-Start No-Ops und binden sich danach an den Provider.
export const counters = {
  ebayRateLimitHits: meter.createCounter('ebay_http_rate_limit_hits'),
  ebayHttpRetries: meter.createCounter('ebay_http_retries'),
  ebayHttpErrors: meter.createCounter('ebay_http_errors'),
  discordSendThrottleWaits: meter.createCounter('discord_send_throttle_waits'),
};

export async function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async span => {
    try {
      return await fn();
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
