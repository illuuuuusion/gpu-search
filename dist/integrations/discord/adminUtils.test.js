import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReminderDuration, renderWelcomeTemplate } from './adminUtils.js';
test('parseReminderDuration parses simple duration syntax', () => {
    assert.equal(parseReminderDuration('2h'), 7_200_000);
    assert.equal(parseReminderDuration('15m'), 900_000);
    assert.equal(parseReminderDuration('3d'), 259_200_000);
});
test('parseReminderDuration rejects invalid input', () => {
    assert.equal(parseReminderDuration('soon'), null);
    assert.equal(parseReminderDuration('10'), null);
});
test('renderWelcomeTemplate replaces placeholders', () => {
    const rendered = renderWelcomeTemplate('Willkommen {mention} auf {server}, {user}!', {
        mention: '<@1>',
        username: 'Jamie',
        server: 'GPU Search',
    });
    assert.equal(rendered, 'Willkommen <@1> auf GPU Search, Jamie!');
});
