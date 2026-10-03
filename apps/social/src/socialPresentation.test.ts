import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedAppearanceScale, messageDayBoundary, socialLayout } from './socialPresentation';

test('phone/tablet and desktop use a deterministic split without invalid widths', () => {
  assert.equal(socialLayout(390).desktop, false);
  assert.equal(socialLayout(899).desktop, false);
  assert.equal(socialLayout(900).desktop, true);
  assert.equal(socialLayout(1440).desktop, true);
  assert.equal(socialLayout(NaN).desktop, false);
});
test('appearance accepts only supported local values and preserves safe default', () => {
  for (const scale of [0.9, 1, 1.15, 1.3]) assert.equal(checkedAppearanceScale(String(scale)), scale);
  for (const invalid of [null, undefined, '0', '4', 'NaN', {}]) assert.equal(checkedAppearanceScale(invalid), 1);
});
test('date separators use actual message dates without inventing delivery states', () => {
  assert.equal(messageDayBoundary('2026-10-03T12:00:00Z'), true);
  assert.equal(messageDayBoundary('2026-10-03T12:00:00Z', '2026-10-03T11:00:00Z'), false);
  assert.equal(messageDayBoundary('2026-10-03T12:00:00Z', '2026-10-01T11:00:00Z'), true);
  assert.equal(messageDayBoundary('invalid'), false);
});
