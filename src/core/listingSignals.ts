import type { EbayListing, EbayListingAspect } from '../types/domain.js';

const BRAND_ASPECT_PATTERNS = [
  /^(?:brand|marke|manufacturer|hersteller|board partner|boardpartner)$/i,
];
const GPU_ASPECT_PATTERNS = [
  /^(?:graphics processor|graphic processor|gpu|gpu model|chipset(?:\/gpu model)?|chipsatz(?:\/gpu modell)?|grafikprozessor)$/i,
];
const MODEL_ASPECT_PATTERNS = [
  /^(?:model|modell|product line|produktlinie|series|edition|version|mpn|herstellernummer)$/i,
];
const HIGH_SIGNAL_ASPECT_PATTERNS = [
  ...BRAND_ASPECT_PATTERNS,
  ...GPU_ASPECT_PATTERNS,
  ...MODEL_ASPECT_PATTERNS,
  /^(?:memory size|speichergröße|memory|speicher)$/i,
];
const KNOWN_BOARD_BRANDS = new Map<string, string>([
  ['aorus', 'AORUS'],
  ['asrock', 'ASRock'],
  ['asus', 'ASUS'],
  ['colorful', 'Colorful'],
  ['evga', 'EVGA'],
  ['gainward', 'Gainward'],
  ['gigabyte', 'Gigabyte'],
  ['inno3d', 'INNO3D'],
  ['kfa2', 'KFA2'],
  ['manli', 'Manli'],
  ['msi', 'MSI'],
  ['palit', 'Palit'],
  ['pny', 'PNY'],
  ['powercolor', 'PowerColor'],
  ['sapphire', 'Sapphire'],
  ['xfx', 'XFX'],
  ['yeston', 'Yeston'],
  ['zotac', 'ZOTAC'],
]);
const GENERIC_MODEL_VALUES = new Set([
  'grafikkarte',
  'graphics card',
  'graphic card',
  'video card',
  'gpu',
  'nicht zutreffend',
  'not applicable',
  'does not apply',
  'n/a',
]);

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function compactComparableText(value: string): string {
  return normalizeComparableText(value).replace(/\s+/g, '');
}

function uniqueTexts(values: Array<string | undefined>): string[] {
  const deduped = new Map<string, string>();

  for (const value of values) {
    const trimmed = value?.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;

    const key = normalizeComparableText(trimmed);
    if (!key || deduped.has(key)) continue;
    deduped.set(key, trimmed);
  }

  return Array.from(deduped.values());
}

function matchesAspectName(name: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(name.trim()));
}

function collectAspectValues(aspects: EbayListingAspect[], patterns: RegExp[]): string[] {
  return uniqueTexts(aspects
    .filter(aspect => matchesAspectName(aspect.name, patterns))
    .map(aspect => aspect.value));
}

function detectBoardBrand(texts: Array<string | undefined>): string | undefined {
  const normalizedTexts = texts
    .filter((value): value is string => Boolean(value))
    .map(value => normalizeComparableText(value));

  for (const [token, display] of Array.from(KNOWN_BOARD_BRANDS.entries()).sort((left, right) => right[0].length - left[0].length)) {
    if (normalizedTexts.some(text => text.includes(token))) {
      return display;
    }
  }

  return undefined;
}

function detectGpuModel(texts: Array<string | undefined>): string | undefined {
  const patterns = [
    /\brtx\s+pro\s+\d{4,5}(?:\s+blackwell)?\b/i,
    /\btitan\s+rtx\b/i,
    /\b(?:rtx|gtx|rx|arc)\s*-?\s*\d{3,4}(?:\s+(?:ti|super|xt|xtx|gre))?\b/i,
  ];

  for (const text of texts) {
    if (!text) continue;

    for (const pattern of patterns) {
      const match = text.match(pattern)?.[0]?.replace(/\s+/g, ' ').trim();
      if (match) {
        return match.toUpperCase().replace(/\bXt\b/g, 'XT').replace(/\bXtx\b/g, 'XTX');
      }
    }
  }

  return undefined;
}

function detectBoardModel(input: {
  aspects: EbayListingAspect[];
  subtitle?: string;
  shortDescription?: string;
}): string | undefined {
  const explicitModel = collectAspectValues(input.aspects, MODEL_ASPECT_PATTERNS)
    .find(candidate => !GENERIC_MODEL_VALUES.has(normalizeComparableText(candidate)));
  if (explicitModel) {
    return explicitModel;
  }

  for (const text of [input.subtitle, input.shortDescription]) {
    const cleaned = text?.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (GENERIC_MODEL_VALUES.has(normalizeComparableText(cleaned))) continue;
    if (cleaned.length >= 6 && cleaned.length <= 140) {
      return cleaned;
    }
  }

  return undefined;
}

export function extractListingIdentity(input: {
  title: string;
  subtitle?: string;
  shortDescription?: string;
  aspects: EbayListingAspect[];
}): Pick<EbayListing, 'boardBrand' | 'boardModel' | 'gpuModel'> {
  const aspectBrand = collectAspectValues(input.aspects, BRAND_ASPECT_PATTERNS)[0];
  const boardBrand = detectBoardBrand([
    aspectBrand,
    input.title,
    input.subtitle,
    input.shortDescription,
    ...input.aspects.map(aspect => aspect.value),
  ]);

  const gpuModel = detectGpuModel([
    ...collectAspectValues(input.aspects, GPU_ASPECT_PATTERNS),
    input.title,
    input.subtitle,
    input.shortDescription,
  ]);

  const boardModel = detectBoardModel(input);

  return {
    boardBrand,
    boardModel,
    gpuModel,
  };
}

export function getListingTextSources(listing: EbayListing): Array<{ label: string; text: string }> {
  const sources = [
    { label: 'title', text: listing.title },
    { label: 'subtitle', text: listing.subtitle },
    { label: 'short_description', text: listing.shortDescription },
    { label: 'condition', text: listing.condition },
    { label: 'board_brand', text: listing.boardBrand },
    { label: 'board_model', text: listing.boardModel },
    { label: 'gpu_model', text: listing.gpuModel },
    ...listing.aspects.map(aspect => ({
      label: `aspect_${normalizeComparableText(aspect.name).replace(/\s+/g, '_') || 'value'}`,
      text: aspect.value,
    })),
  ];

  return sources.filter((source): source is { label: string; text: string } => Boolean(source.text?.trim()));
}

export function buildListingSearchText(listing: EbayListing): string {
  const highSignalAspectValues = collectAspectValues(listing.aspects, HIGH_SIGNAL_ASPECT_PATTERNS);
  return uniqueTexts([
    listing.title,
    listing.subtitle,
    listing.shortDescription,
    listing.boardBrand,
    listing.boardModel,
    listing.gpuModel,
    ...highSignalAspectValues,
  ]).join(' ');
}

export function buildListingReferenceText(listing: EbayListing): string {
  const highSignalAspectValues = collectAspectValues(listing.aspects, HIGH_SIGNAL_ASPECT_PATTERNS).slice(0, 8);
  return uniqueTexts([
    listing.gpuModel,
    listing.boardBrand,
    listing.boardModel,
    listing.title,
    listing.subtitle,
    listing.shortDescription,
    ...highSignalAspectValues,
  ]).join(' ');
}
