import { describe, it, expect } from 'vitest';
import { money, fmtDuration, fmtTime, errorMessage, holdSecondsLeft } from './booking';

describe('money', () => {
  it('formats INR without decimals', () => {
    expect(money('4250', 'INR')).toMatch(/₹\s?4,250/);
  });
  it('formats USD with cents', () => {
    expect(money('123.5', 'USD')).toBe('$123.50');
  });
});

describe('time helpers', () => {
  it('formats durations', () => {
    expect(fmtDuration(125)).toBe('2h 05m');
    expect(fmtDuration(60)).toBe('1h 00m');
  });
  it('extracts HH:MM from an ISO string', () => {
    expect(fmtTime('2026-11-15T09:05')).toBe('09:05');
  });
});

describe('errorMessage', () => {
  it('returns string details as-is', () => {
    expect(errorMessage({ detail: 'Not enough seats' }, 'x')).toBe('Not enough seats');
  });
  it('joins validation errors with their field path', () => {
    const body = { detail: [{ loc: ['body', 'passengers', 0, 'name'], msg: 'Name must be 2-80 letters' }] };
    expect(errorMessage(body, 'x')).toBe('passengers › 0 › name: Name must be 2-80 letters');
  });
  it('falls back when there is no detail', () => {
    expect(errorMessage(null, 'Request failed (500)')).toBe('Request failed (500)');
  });
});

describe('holdSecondsLeft', () => {
  const expires = '2026-10-11T08:10:00';
  const at = (s) => new Date(`2026-10-11T08:${s}Z`).getTime();
  it('counts down in seconds', () => {
    expect(holdSecondsLeft(expires, at('08:00'))).toBe(120);
  });
  it('never goes negative', () => {
    expect(holdSecondsLeft(expires, at('11:00'))).toBe(0);
  });
  it('is zero when no hold exists', () => {
    expect(holdSecondsLeft(null, Date.now())).toBe(0);
  });
});
