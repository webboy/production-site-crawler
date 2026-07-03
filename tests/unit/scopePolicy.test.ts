import { describe, expect, it } from 'vitest';
import { ScopePolicy } from '../../src/url/ScopePolicy.js';

describe('ScopePolicy', () => {
  it('allows the same registrable domain by default, including subdomains', () => {
    const policy = new ScopePolicy('https://www.x.com/');

    expect(policy.getDescriptor()).toEqual({
      policy: 'registrable_domain',
      value: 'x.com',
    });
    expect(policy.isInScope('https://x.com/')).toBe(true);
    expect(policy.isInScope('https://www.x.com/a')).toBe(true);
    expect(policy.isInScope('https://blog.x.com/post')).toBe(true);
  });

  it('rejects other domains, deceptive suffixes, and unsupported schemes', () => {
    const policy = new ScopePolicy('https://www.x.com/');

    expect(policy.isInScope('https://other.com/')).toBe(false);
    expect(policy.isInScope('https://x.com.evil.com/')).toBe(false);
    expect(policy.isInScope('mailto:test@x.com')).toBe(false);
    expect(policy.isInScope('ftp://x.com/file')).toBe(false);
  });

  it('can require exact hostname matches', () => {
    const policy = new ScopePolicy('https://www.x.com/', 'exact_hostname');

    expect(policy.getDescriptor()).toEqual({
      policy: 'exact_hostname',
      value: 'www.x.com',
    });
    expect(policy.isInScope('https://www.x.com/a')).toBe(true);
    expect(policy.isInScope('https://x.com/')).toBe(false);
    expect(policy.isInScope('https://blog.x.com/')).toBe(false);
  });

  it('keeps subdomain allowlist as an explicit deferral', () => {
    expect(() => new ScopePolicy('https://www.x.com/', 'subdomain_allowlist')).toThrow(
      'subdomain_allowlist scope policy is deferred',
    );
  });
});
