export const VALORANT_TOURNAMENT_SEEDS = [
    {
        key: 'americas-kickoff',
        scope: 'americas',
        pageTitleTemplates: ['VCT/{year}/Americas_League/Kickoff'],
        searchQueries: ['VCT {year}: Americas Kickoff', 'VCT {year}: Americas League Kickoff'],
    },
    {
        key: 'americas-stage-1',
        scope: 'americas',
        pageTitleTemplates: ['VCT/{year}/Americas_League/Stage_1'],
        searchQueries: ['VCT {year}: Americas Stage 1', 'VCT {year}: Americas League Stage 1'],
    },
    {
        key: 'americas-stage-2',
        scope: 'americas',
        pageTitleTemplates: ['VCT/{year}/Americas_League/Stage_2'],
        searchQueries: ['VCT {year}: Americas Stage 2', 'VCT {year}: Americas League Stage 2'],
    },
    {
        key: 'emea-kickoff',
        scope: 'emea',
        pageTitleTemplates: ['VCT/{year}/EMEA_League/Kickoff'],
        searchQueries: ['VCT {year}: EMEA Kickoff', 'VCT {year}: EMEA League Kickoff'],
    },
    {
        key: 'emea-stage-1',
        scope: 'emea',
        pageTitleTemplates: ['VCT/{year}/EMEA_League/Stage_1'],
        searchQueries: ['VCT {year}: EMEA Stage 1', 'VCT {year}: EMEA League Stage 1'],
    },
    {
        key: 'emea-stage-2',
        scope: 'emea',
        pageTitleTemplates: ['VCT/{year}/EMEA_League/Stage_2'],
        searchQueries: ['VCT {year}: EMEA Stage 2', 'VCT {year}: EMEA League Stage 2'],
    },
    {
        key: 'pacific-kickoff',
        scope: 'pacific',
        pageTitleTemplates: ['VCT/{year}/Pacific_League/Kickoff'],
        searchQueries: ['VCT {year}: Pacific Kickoff', 'VCT {year}: Pacific League Kickoff'],
    },
    {
        key: 'pacific-stage-1',
        scope: 'pacific',
        pageTitleTemplates: ['VCT/{year}/Pacific_League/Stage_1'],
        searchQueries: ['VCT {year}: Pacific Stage 1', 'VCT {year}: Pacific League Stage 1'],
    },
    {
        key: 'pacific-stage-2',
        scope: 'pacific',
        pageTitleTemplates: ['VCT/{year}/Pacific_League/Stage_2'],
        searchQueries: ['VCT {year}: Pacific Stage 2', 'VCT {year}: Pacific League Stage 2'],
    },
    {
        key: 'china-kickoff',
        scope: 'china',
        pageTitleTemplates: ['VCT/{year}/China_League/Kickoff'],
        searchQueries: ['VCT {year}: China Kickoff', 'VCT {year}: China League Kickoff'],
    },
    {
        key: 'china-stage-1',
        scope: 'china',
        pageTitleTemplates: ['VCT/{year}/China_League/Stage_1'],
        searchQueries: ['VCT {year}: China Stage 1', 'VCT {year}: China League Stage 1'],
    },
    {
        key: 'china-stage-2',
        scope: 'china',
        pageTitleTemplates: ['VCT/{year}/China_League/Stage_2'],
        searchQueries: ['VCT {year}: China Stage 2', 'VCT {year}: China League Stage 2'],
    },
    {
        key: 'masters',
        scope: 'masters',
        pageTitleTemplates: [],
        searchQueries: ['VCT {year}: Masters', 'VCT {year}: Masters Bangkok', 'VCT {year}: Masters Toronto', 'VCT {year}: Masters Madrid', 'VCT {year}: Masters Shanghai'],
    },
    {
        key: 'champions',
        scope: 'champions',
        pageTitleTemplates: ['VALORANT_Champions/{year}'],
        searchQueries: ['VALORANT Champions {year}', 'Valorant Champions {year}'],
    },
];
export function renderPageTitleTemplate(template, year) {
    return template.replaceAll('{year}', String(year));
}
export function renderSearchQuery(template, year) {
    return template.replaceAll('{year}', String(year));
}
export function getDiscoveryYears(windowDays, now = new Date()) {
    const windowStart = new Date(now);
    windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);
    const years = new Set([
        windowStart.getUTCFullYear(),
        now.getUTCFullYear(),
    ]);
    return [...years].sort((left, right) => left - right);
}
