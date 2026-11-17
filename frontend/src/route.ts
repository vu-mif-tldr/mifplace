import { EmailTokenSchema } from '@mifplace/shared';

// What the address asks the page to show. The emails of the accounts link to the page with
// the token after "#": /#/verify/<token> and /#/reset/<token>. That part of an address is
// never sent to a server, so the token stays out of access logs.
export type Route =
  | { name: 'home' }
  // The link of the registration email: confirm the address
  | { name: 'verify'; token: string }
  // The link of the "forgot password" email: set a new password
  | { name: 'reset'; token: string };

// `hash` is location.hash. Anything that is not one of the two links is the home page.
export function parseRoute(hash: string): Route {
  const match = hash.match(/^#\/(verify|reset)\/([^/]+)$/);
  if (!match || !EmailTokenSchema.safeParse(match[2]).success) return { name: 'home' };
  return { name: match[1] as 'verify' | 'reset', token: match[2]! };
}

// Takes the token out of the address bar once it is used, without reloading the page.
export function clearRoute(): void {
  history.replaceState(null, '', location.pathname + location.search);
}
