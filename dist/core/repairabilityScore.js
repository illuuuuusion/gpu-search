import { getListingTextSources } from './listingSignals.js';
const POSITIVE_SIGNALS = [
    {
        reason: 'symptom_no_display',
        weight: 18,
        patterns: [/\b(?:kein bild|no display|no signal|kein signal)\b/i],
    },
    {
        reason: 'symptom_artifacts',
        weight: 16,
        patterns: [/\b(?:artefakte|artifacts?|artifakte)\b/i],
    },
    {
        reason: 'symptom_driver_load',
        weight: 12,
        patterns: [/\b(?:treiberabst(?:u|ü)rze|driver crash|stürzt unter last ab|unter last)\b/i],
    },
    {
        reason: 'board_complete',
        weight: 10,
        patterns: [/\b(?:komplett|vollst(?:a|ä)ndig|mit k(?:u|ü)hler|mit l(?:u|ü)fter|inkl\.?\s*k(?:u|ü)hler)\b/i],
    },
    {
        reason: 'untouched_card',
        weight: 8,
        patterns: [/\b(?:unverbastelt|nicht ge(?:o|oe)ffnet|unge(?:o|oe)ffnet|originalzustand)\b/i],
    },
    {
        reason: 'powers_on',
        weight: 10,
        patterns: [/\b(?:l(?:u|ü)fter drehen|fan spin|geht an|startet noch|leuchtet noch)\b/i],
    },
];
const NEGATIVE_SIGNALS = [
    {
        reason: 'missing_core_parts',
        weight: -60,
        patterns: [/\b(?:ohne chip|kein chip|ohne gpu|gpu fehlt|ohne vram|kein vram|speicher fehlt)\b/i],
    },
    {
        reason: 'physical_damage',
        weight: -40,
        patterns: [/\b(?:pcb gebrochen|broken pcb|cracked pcb|gerissen|abgebrochen|broken in half)\b/i],
    },
    {
        reason: 'burn_or_water_damage',
        weight: -35,
        patterns: [/\b(?:verbrannt|abgebrannt|brandschaden|verschmort|wasserschaden|water damage)\b/i],
    },
    {
        reason: 'already_reworked',
        weight: -22,
        patterns: [/\b(?:reflow|reballing|reballed|reparaturversuch|repair attempt|schon repariert)\b/i],
    },
    {
        reason: 'parts_only',
        weight: -30,
        patterns: [/\b(?:nur teile|for parts only|nur board|bare pcb|only pcb)\b/i],
    },
    {
        reason: 'untested_unclear',
        weight: -10,
        patterns: [/\b(?:ungetestet|untested|geht nicht|unknown fault|unbekannter fehler)\b/i],
    },
];
function buildAssessmentText(listing) {
    const sourceTexts = getListingTextSources(listing)
        .map(source => source.text)
        .filter(Boolean);
    return Array.from(new Set(sourceTexts))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function applySignals(text, signals) {
    let scoreDelta = 0;
    const reasons = [];
    for (const signal of signals) {
        if (!signal.patterns.some(pattern => pattern.test(text))) {
            continue;
        }
        scoreDelta += signal.weight;
        reasons.push(signal.reason);
    }
    return { scoreDelta, reasons };
}
function clampScore(value) {
    return Math.max(0, Math.min(100, value));
}
function resolveConfidence(reasons) {
    if (reasons.length >= 3) {
        return 'high';
    }
    if (reasons.length >= 1) {
        return 'medium';
    }
    return 'low';
}
export function assessRepairability(listing) {
    const text = buildAssessmentText(listing);
    let score = 50;
    const reasons = [];
    const positive = applySignals(text, POSITIVE_SIGNALS);
    score += positive.scoreDelta;
    reasons.push(...positive.reasons);
    const negative = applySignals(text, NEGATIVE_SIGNALS);
    score += negative.scoreDelta;
    reasons.push(...negative.reasons);
    if (reasons.length === 0) {
        reasons.push('insufficient_signal');
        score -= 10;
    }
    return {
        score: clampScore(score),
        confidence: resolveConfidence(reasons),
        reasons,
    };
}
