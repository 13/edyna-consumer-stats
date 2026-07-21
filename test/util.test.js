import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNumber, parseDayDate, hourTimestamps } from '../src/util.js';

describe('normalizeNumber', () => {
  test('parses de-AT formatted numbers', () => {
    assert.equal(normalizeNumber('1.234,56'), 1234.56);
    assert.equal(normalizeNumber('0,5'), 0.5);
    assert.equal(normalizeNumber('12'), 12);
    assert.equal(normalizeNumber('-3,2'), -3.2);
  });

  test('strips non-numeric noise', () => {
    assert.equal(normalizeNumber('123,4 kWh'), 123.4);
  });

  test('treats dot as thousands separator (locale assumption)', () => {
    assert.equal(normalizeNumber('1.5'), 15);
  });

  test('returns null for empty and placeholder values', () => {
    assert.equal(normalizeNumber(''), null);
    assert.equal(normalizeNumber(null), null);
    assert.equal(normalizeNumber('-'), null);
    assert.equal(normalizeNumber('N/A'), null);
    assert.equal(normalizeNumber('abc'), null);
  });
});

describe('parseDayDate', () => {
  test('parses dd.mm.yyyy and dd/mm/yyyy', () => {
    assert.deepEqual(parseDayDate('15.12.2025'), { year: 2025, month: 12, day: 15 });
    assert.deepEqual(parseDayDate('05/03/2024'), { year: 2024, month: 3, day: 5 });
    assert.deepEqual(parseDayDate('5.3.2024'), { year: 2024, month: 3, day: 5 });
  });

  test('parses ISO yyyy-mm-dd', () => {
    assert.deepEqual(parseDayDate('2025-01-31'), { year: 2025, month: 1, day: 31 });
  });

  test('uses fallback year for dd.mm without year', () => {
    assert.deepEqual(parseDayDate('15.12', 2024), { year: 2024, month: 12, day: 15 });
    assert.equal(parseDayDate('15.12'), null);
  });

  test('returns null for garbage', () => {
    assert.equal(parseDayDate(''), null);
    assert.equal(parseDayDate('foo'), null);
    assert.equal(parseDayDate(null), null);
  });
});

describe('hourTimestamps', () => {
  test('produces consecutive hours from local midnight', () => {
    const ts = hourTimestamps({ year: 2025, month: 6, day: 15 }, 24);
    assert.equal(ts.length, 24);
    for (let h = 1; h < ts.length; h++) {
      assert.equal(ts[h].getTime() - ts[h - 1].getTime(), 3_600_000);
    }
  });

  test('DST days keep distinct consecutive timestamps for every column', () => {
    // 2025-10-26 is the 25-hour day in Europe/Rome; even if the process TZ
    // differs, all 25 columns must map to 25 distinct, strictly increasing hours
    const ts = hourTimestamps({ year: 2025, month: 10, day: 26 }, 25);
    const unique = new Set(ts.map(t => t.getTime()));
    assert.equal(unique.size, 25);
    assert.equal(ts[24].getTime() - ts[0].getTime(), 24 * 3_600_000);
  });
});
