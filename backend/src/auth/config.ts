// Which addresses may register (FR-2): ALLOWED_EMAIL_DOMAINS, comma-separated, each domain
// with its subdomains. Unset or empty gives vu.lt. A value that is not a domain name stops
// the server at start: a typo must not silently let nobody, or everybody, in.
export function emailDomainsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.ALLOWED_EMAIL_DOMAINS;
  if (raw === undefined || raw.trim() === '') return ['vu.lt'];
  const domains = raw.split(',').map((domain) => domain.trim().toLowerCase());
  for (const domain of domains) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
      throw new Error(`Invalid ALLOWED_EMAIL_DOMAINS: ${raw}`);
    }
  }
  return domains;
}
