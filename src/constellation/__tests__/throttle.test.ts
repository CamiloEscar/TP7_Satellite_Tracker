import { createThrottle } from '../index';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('createThrottle', () => {
  it('runs the first call immediately (leading edge)', () => {
    const fn = jest.fn();
    const throttled = createThrottle(fn, 5000);
    throttled('a');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('coalesces calls inside the window into one trailing call with the latest args', () => {
    const fn = jest.fn();
    const throttled = createThrottle(fn, 5000);

    throttled(1); // leading: runs now
    jest.advanceTimersByTime(1000);
    throttled(2); // inside the window
    jest.advanceTimersByTime(1000);
    throttled(3); // inside the window, latest args win
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(3000); // window closes
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it('runs immediately again once the window elapsed', () => {
    const fn = jest.fn();
    const throttled = createThrottle(fn, 5000);

    throttled();
    jest.advanceTimersByTime(5000);
    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('drops the pending trailing call on cancel', () => {
    const fn = jest.fn();
    const throttled = createThrottle(fn, 5000);

    throttled(); // leading
    jest.advanceTimersByTime(1000);
    throttled(); // trailing pending
    throttled.cancel();
    jest.advanceTimersByTime(10000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
