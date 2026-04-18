export const searchBuckets = [
    {
        id: 'nvidia-legacy',
        name: 'NVIDIA Legacy',
        query: 'RTX (2080, 2080 super, 2080 ti, titan)',
        profileMatchers: ['nvidia turing'],
    },
    {
        id: 'nvidia-ampere',
        name: 'NVIDIA Ampere',
        query: 'RTX (3060, 3060 ti, 3070 ti, 3080, 3080 ti, 3090, 3090 ti)',
        profileMatchers: ['nvidia ampere'],
    },
    {
        id: 'nvidia-ada',
        name: 'NVIDIA Ada',
        query: 'RTX (4060, 4060 ti, 4070, 4070 super, 4070 ti, 4080, 4080 super, 4090)',
        profileMatchers: ['ada lovelace'],
    },
    {
        id: 'nvidia-blackwell-pro',
        name: 'NVIDIA Blackwell & Pro',
        query: 'RTX (5060, 5060 ti, 5070, 5070 ti, 5080, 5090, pro 6000)',
        profileMatchers: ['nvidia blackwell'],
    },
    {
        id: 'amd-intel',
        name: 'AMD & Intel',
        query: '(rx 6800, rx 6900, rx 6950, rx 7700, rx 7800, rx 7900, rx 9070, intel arc, arc a770)',
        profileMatchers: ['amd rdna', 'intel arc'],
    },
];
// 5 Buckets bisher
export function profileBelongsToBucket(bucket, profile) {
    const haystack = `${profile.name} ${profile.category}`.toLowerCase();
    return bucket.profileMatchers.some(matcher => haystack.includes(matcher));
}
