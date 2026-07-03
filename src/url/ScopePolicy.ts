import { getDomain } from 'tldts';

export type ScopePolicyName = 'registrable_domain' | 'exact_hostname' | 'subdomain_allowlist';

export interface ScopeDescriptor {
  policy: ScopePolicyName;
  value: string;
}

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return SUPPORTED_PROTOCOLS.has(url.protocol.toLowerCase()) ? url : null;
  } catch {
    return null;
  }
}

function registrableDomainOrHost(hostname: string): string {
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname.toLowerCase();
}

export class ScopePolicy {
  private readonly descriptor: ScopeDescriptor;

  constructor(seedNormalizedUrl: string, policy: ScopePolicyName = 'registrable_domain') {
    if (policy === 'subdomain_allowlist') {
      throw new Error('subdomain_allowlist scope policy is deferred');
    }

    const seedUrl = parseHttpUrl(seedNormalizedUrl);

    if (seedUrl === null) {
      throw new Error(`Invalid seed URL for scope policy: ${seedNormalizedUrl}`);
    }

    this.descriptor = {
      policy,
      value:
        policy === 'registrable_domain'
          ? registrableDomainOrHost(seedUrl.hostname)
          : seedUrl.hostname.toLowerCase(),
    };
  }

  getDescriptor(): ScopeDescriptor {
    return this.descriptor;
  }

  isInScope(candidateAbsoluteUrl: string): boolean {
    const candidateUrl = parseHttpUrl(candidateAbsoluteUrl);

    if (candidateUrl === null) {
      return false;
    }

    const candidateScope =
      this.descriptor.policy === 'registrable_domain'
        ? registrableDomainOrHost(candidateUrl.hostname)
        : candidateUrl.hostname.toLowerCase();

    return candidateScope === this.descriptor.value;
  }
}
