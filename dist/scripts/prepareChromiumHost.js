import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const DEB_OUTPUT_PATH = path.resolve(process.cwd(), 'vendor/chromium-debs');
const LIB_OUTPUT_PATH = path.resolve(process.cwd(), 'vendor/chromium-libs');
const PACKAGE_ALTERNATIVES = [
    ['libnspr4'],
    ['libnss3'],
    ['libatk1.0-0t64', 'libatk1.0-0'],
    ['libatk-bridge2.0-0t64', 'libatk-bridge2.0-0'],
    ['libgtk-3-0t64', 'libgtk-3-0'],
    ['libxdamage1'],
    ['libxkbcommon0'],
    ['libasound2t64', 'libasound2'],
    ['libatspi2.0-0t64', 'libatspi2.0-0'],
    ['libpangocairo-1.0-0'],
    ['libpangoft2-1.0-0'],
    ['libcairo-gobject2'],
    ['libepoxy0'],
    ['libcloudproviders0'],
    ['libwayland-cursor0'],
    ['libwayland-egl1'],
];
async function resolvePackageName(candidates) {
    for (const candidate of candidates) {
        try {
            const { stdout } = await execFileAsync('apt-cache', ['policy', candidate]);
            const candidateLine = stdout
                .split('\n')
                .find(line => line.trim().startsWith('Candidate:'));
            if (candidateLine && !candidateLine.includes('(none)')) {
                return candidate;
            }
        }
        catch {
            // Continue with the next candidate.
        }
    }
    throw new Error(`No installable package found for ${candidates.join(' / ')}`);
}
async function main() {
    const packageNames = await Promise.all(PACKAGE_ALTERNATIVES.map(resolvePackageName));
    await fs.mkdir(DEB_OUTPUT_PATH, { recursive: true });
    await fs.mkdir(LIB_OUTPUT_PATH, { recursive: true });
    console.log(`Downloading packages to ${DEB_OUTPUT_PATH}`);
    await execFileAsync('apt', ['download', ...packageNames], {
        cwd: DEB_OUTPUT_PATH,
        maxBuffer: 1024 * 1024 * 8,
    });
    const files = (await fs.readdir(DEB_OUTPUT_PATH))
        .filter(file => file.endsWith('.deb'))
        .map(file => path.join(DEB_OUTPUT_PATH, file));
    for (const file of files) {
        console.log(`Extracting ${path.basename(file)}`);
        await execFileAsync('dpkg-deb', ['-x', file, LIB_OUTPUT_PATH], {
            maxBuffer: 1024 * 1024 * 8,
        });
    }
    console.log(`Prepared Chromium user-space libraries in ${LIB_OUTPUT_PATH}`);
}
main().catch(error => {
    console.error(error);
    process.exit(1);
});
