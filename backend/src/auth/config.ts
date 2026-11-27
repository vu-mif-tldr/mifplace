import { AccountEmailSchema } from '@mifplace/shared';

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

// Who is an administrator: ADMIN_EMAILS, comma-separated addresses. The backend gives the
// role to the verified accounts with these addresses at start and takes it from everybody
// else, so the list in the environment is the whole truth. Unset or empty: nobody. An entry
// that is not an address stops the server at start.
export function adminEmailsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.ADMIN_EMAILS;
  if (raw === undefined || raw.trim() === '') return [];
  const emails = raw.split(',').map((entry) => {
    const email = AccountEmailSchema.safeParse(entry);
    if (!email.success)
      throw new Error(`Invalid ADMIN_EMAILS: "${entry.trim()}" is not an address`);
    return email.data;
  });
  return [...new Set(emails)];
}
