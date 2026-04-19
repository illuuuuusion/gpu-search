import fs from 'node:fs/promises';
import path from 'node:path';
async function main() {
    process.env.EBAY_PROVIDER ??= 'mock';
    process.env.MARKET_REFERENCE_PROVIDER ??= 'none';
    process.env.SCANNER_STATE_PATH ??= path.resolve(process.cwd(), 'data/scanner-state.test.json');
    if ((process.env.RESET_TEST_STATE ?? 'true').toLowerCase() !== 'false') {
        await fs.rm(process.env.SCANNER_STATE_PATH, { force: true }).catch(() => undefined);
    }
    const [{ env }, { loadProfiles }, { ScannerService }, notifierModule] = await Promise.all([
        import('../config/env.js'),
        import('../core/profileLoader.js'),
        import('../core/scanner.js'),
        import('../integrations/notifier.js'),
    ]);
    const { DiscordNotifier } = await import('../integrations/discord/notifier.js');
    const profileFilter = process.env.TEST_PROFILE_NAME?.trim().toLowerCase();
    const profiles = loadProfiles().filter(profile => {
        if (!profileFilter) {
            return profile.name === 'RTX 5080';
        }
        return profile.name.toLowerCase() === profileFilter ||
            profile.aliases.some(alias => alias.toLowerCase() === profileFilter);
    });
    if (profiles.length === 0) {
        throw new Error(`No GPU profile matched TEST_PROFILE_NAME=${process.env.TEST_PROFILE_NAME}`);
    }
    const notifier = env.NOTIFIER_PROVIDER === 'discord'
        ? new DiscordNotifier()
        : new notifierModule.ConsoleNotifier();
    if ('start' in notifier && typeof notifier.start === 'function') {
        await notifier.start();
    }
    const scanner = new ScannerService(notifier);
    await scanner.runOnce(profiles);
    console.log(`Mock scan finished for ${profiles.map(profile => profile.name).join(', ')} using ${env.NOTIFIER_PROVIDER}.`);
}
main().catch(error => {
    console.error(error);
    process.exit(1);
});
