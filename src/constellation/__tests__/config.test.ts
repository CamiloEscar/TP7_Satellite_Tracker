import {
  CONSTELLATION_GROUP_CHIPS,
  DEFAULT_CONSTELLATION_GROUP,
  DEFAULT_CONSTELLATION_LIMIT,
  MAX_CONSTELLATION_LIMIT,
  MIN_CONSTELLATION_LIMIT,
  getConstellationGroup,
  getConstellationLimit,
  parseConstellationLimit,
  setConstellationGroup,
  setConstellationLimit,
  subscribeConstellationGroup,
  subscribeConstellationLimit,
} from '../index';

beforeEach(() => {
  setConstellationLimit(DEFAULT_CONSTELLATION_LIMIT);
  setConstellationGroup(DEFAULT_CONSTELLATION_GROUP);
});

describe('constellation config store', () => {
  it('defaults to a 50-object Starlink subset', () => {
    expect(getConstellationLimit()).toBe(50);
    expect(getConstellationGroup()).toBe('starlink');
  });

  it('sets and gets the limit and the group', () => {
    setConstellationLimit(100);
    setConstellationGroup('gps-ops');
    expect(getConstellationLimit()).toBe(100);
    expect(getConstellationGroup()).toBe('gps-ops');
  });

  it('notifies limit subscribers and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeConstellationLimit(listener);
    setConstellationLimit(25);
    expect(listener).toHaveBeenCalledWith(25);
    unsubscribe();
    setConstellationLimit(50);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies group subscribers and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeConstellationGroup(listener);
    setConstellationGroup('iss');
    expect(listener).toHaveBeenCalledWith('iss');
    unsubscribe();
    setConstellationGroup('starlink');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('covers every catalog group in the settings chips', () => {
    expect(CONSTELLATION_GROUP_CHIPS.map(chip => chip.key).sort()).toEqual(
      ['all', 'gps-ops', 'iss', 'other', 'starlink', 'weather'].sort(),
    );
  });
});

describe('parseConstellationLimit', () => {
  it.each([
    ['50', 50],
    [' 25 ', 25],
    ['1', MIN_CONSTELLATION_LIMIT],
    ['100', MAX_CONSTELLATION_LIMIT],
  ])('parses %p as %p', (text, expected) => {
    expect(parseConstellationLimit(text)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '2.5', '-1', '0', '101'])('rejects %p', text => {
    expect(parseConstellationLimit(text)).toBeNull();
  });
});
