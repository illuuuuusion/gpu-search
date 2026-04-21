import { ValorantModule } from '../apps/valorant/module.js';

async function main(): Promise<void> {
  const module = new ValorantModule();
  try {
    const result = await module.triggerManualSync();

    console.log(JSON.stringify({
      status: result.run.status,
      provider: result.run.provider,
      trigger: result.run.trigger,
      importedEvents: result.run.importedEvents,
      parsedCompositions: result.run.parsedCompositions,
      aggregatedFullComps: result.run.aggregatedFullComps,
      lastSuccessfulSyncAt: result.state.metadata.lastSuccessfulSyncAt,
    }, null, 2));
  } finally {
    module.stop();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
