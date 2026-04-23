import assert from 'node:assert/strict';
import { extractVlrEventCards, parseVlrEventImport } from '../apps/valorant/providers/vlr/provider.js';
const eventsFixtureHtml = `
  <a class="wf-card mod-flex event-item" href="/event/854/valorant-masters-toronto-2026">
    <div class="event-item-title">VALORANT Masters Toronto 2026</div>
    <span class="event-item-desc-item-status mod-completed">Completed</span>
  </a>
  <a class="wf-card mod-flex event-item" href="/event/999/community-cup">
    <div class="event-item-title">Community Cup 2026</div>
    <span class="event-item-desc-item-status mod-ongoing">Ongoing</span>
  </a>
`;
const agentsFixtureHtml = `
  <div class="ge-text-light event-desc-item-label">Dates</div>
  <div class="event-desc-item-value">2026-06-07 - 2026-06-22</div>

  <div class="pr-matrix-map">
    <table>
      <tr>
        <th><span class="map-pseudo-icon"></span> Ascent</th>
        <th><img title="Jett" /></th>
        <th><img title="Sova" /></th>
        <th><img title="Omen" /></th>
        <th><img title="Killjoy" /></th>
        <th><img title="Skye" /></th>
      </tr>
      <tr class="pr-matrix-row">
        <td><a class="pr-matrix-toggle" data-vs-id="6x257"></a></td>
        <td><span class="text-of">FNATIC</span></td>
      </tr>
      <tr class="pr-matrix-row mod-dropdown 6x257">
        <td class="mod-win">
          <a href="/12345/fnatic-vs-g2-esports-valorant-masters-toronto-2026/?map=1">
            <span style="color: #888; font-weight: 400; margin-right: 4px;">vs.</span> G2 Esports
          </a>
        </td>
        <td></td>
        <td class="mod-picked-lite"></td>
        <td class="mod-picked-lite"></td>
        <td class="mod-picked-lite"></td>
        <td class="mod-picked-lite"></td>
        <td class="mod-picked-lite"></td>
      </tr>
    </table>
  </div>
`;
function run() {
    const cards = extractVlrEventCards(eventsFixtureHtml, 'https://www.vlr.gg');
    assert.equal(cards.length, 2, 'expected two discoverable event cards');
    const mastersCard = cards.find(card => card.id === '854');
    assert.ok(mastersCard, 'expected masters event card to be found');
    const parsed = parseVlrEventImport(mastersCard, agentsFixtureHtml, new Date('2026-06-22T12:00:00.000Z'));
    assert.ok(parsed.event, 'expected event metadata to be parsed');
    assert.equal(parsed.event?.scope, 'masters');
    assert.equal(parsed.event?.status, 'completed');
    assert.equal(parsed.compositions.length, 1, 'expected one parsed composition');
    assert.equal(parsed.matchPaths.length, 1, 'expected one match path');
    assert.equal(parsed.warnings.length, 0, 'expected no parser warnings for healthy fixture');
    const [composition] = parsed.compositions;
    assert.equal(composition.mapName, 'ascent');
    assert.equal(composition.teamName, 'FNATIC');
    assert.deepEqual(composition.agents, ['jett', 'sova', 'omen', 'killjoy', 'skye']);
    assert.equal(composition.won, true);
    assert.equal(composition.sourceEventId, '854');
    assert.ok(composition.sourceUrl?.includes('/12345/'), 'expected composition source url to point to match page');
    console.log('VALORANT VLR fixture check passed');
}
run();
