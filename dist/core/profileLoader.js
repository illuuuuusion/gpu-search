import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profilesPath = path.resolve(__dirname, '../../config/gpu-profiles.json');
const priceSchema = z.object({
    buyNowWorking: z.number(),
    buyNowDefect: z.number(),
    auctionWorking: z.number(),
    auctionDefect: z.number(),
});
const profileSchema = z.object({
    name: z.string(),
    aliases: z.array(z.string()).min(1),
    negativeAliases: z.array(z.string()),
    vramGb: z.number(),
    category: z.string(),
    vramVariants: z.boolean(),
    excludeNew: z.boolean(),
    onlyGermany: z.boolean(),
    minimumRetailDiscountPercent: z.number().optional(),
    prices: priceSchema,
});
export function loadProfiles() {
    const raw = fs.readFileSync(profilesPath, 'utf-8');
    return z.array(profileSchema).parse(JSON.parse(raw));
}
