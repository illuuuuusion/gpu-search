import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const PLAYWRIGHT_CACHE_PATH = path.resolve(process.env.HOME ?? process.cwd(), '.cache/ms-playwright');
const LOCAL_CHROMIUM_LIB_PATH = path.resolve(process.cwd(), 'vendor/chromium-libs/usr/lib/x86_64-linux-gnu');
async function findExecutable(prefix, relativePath) {
    try {
        const entries = await fs.readdir(PLAYWRIGHT_CACHE_PATH, { withFileTypes: true });
        const matchingDirectory = entries
            .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
            .map(entry => entry.name)
            .sort()
            .reverse()[0];
        if (!matchingDirectory) {
            return undefined;
        }
        const executablePath = path.join(PLAYWRIGHT_CACHE_PATH, matchingDirectory, relativePath);
        await fs.access(executablePath);
        return executablePath;
    }
    catch {
        return undefined;
    }
}
async function inspectExecutable(label, executablePath) {
    if (!executablePath) {
        console.log(`${label}: not installed`);
        return;
    }
    try {
        const { stdout } = await execFileAsync('ldd', [executablePath], {
            env: {
                ...process.env,
                LD_LIBRARY_PATH: [LOCAL_CHROMIUM_LIB_PATH, process.env.LD_LIBRARY_PATH]
                    .filter((value) => Boolean(value))
                    .join(':'),
            },
        });
        const missingLibraries = stdout
            .split('\n')
            .filter(line => line.includes('=> not found'))
            .map(line => line.trim());
        console.log(`${label}: ${executablePath}`);
        if (missingLibraries.length === 0) {
            console.log('  shared libs: ok');
        }
        else {
            console.log('  missing shared libs:');
            for (const line of missingLibraries) {
                console.log(`  - ${line}`);
            }
        }
    }
    catch (error) {
        console.log(`${label}: failed to inspect`);
        console.log(String(error));
    }
}
async function main() {
    console.log(`OS: ${os.platform()} ${os.release()}`);
    console.log(`Playwright cache: ${PLAYWRIGHT_CACHE_PATH}`);
    console.log(`User-space Chromium libs: ${LOCAL_CHROMIUM_LIB_PATH}`);
    await inspectExecutable('chromium', await findExecutable('chromium-', 'chrome-linux64/chrome'));
    await inspectExecutable('chromium_headless_shell', await findExecutable('chromium_headless_shell-', 'chrome-headless-shell-linux64/chrome-headless-shell'));
    await inspectExecutable('firefox', await findExecutable('firefox-', 'firefox/firefox'));
    await inspectExecutable('webkit', await findExecutable('webkit-', 'pw_run.sh'));
}
main().catch(error => {
    console.error(error);
    process.exit(1);
});
