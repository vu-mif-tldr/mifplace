import express, { Router, type RequestHandler, type Response } from 'express';
import type { AdminUserRow } from '@mifplace/db';
import {
  AdminUsersQuerySchema,
  BlockUserRequestSchema,
  zodErrorMessage,
  type AdminUser,
  type AdminUserResponse,
  type AdminUsersResponse,
  type AuthErrorCode,
  type AuthErrorResponse,
} from '@mifplace/shared';
import { limiter, type RateLimits } from '../rate-limits.js';
import { sessionUser } from './guard.js';
import type { SessionsEnded } from './sessions.js';

// What administrators can do to accounts: /api/admin (docs/api.md, "Administrators").
// There are no admin screens yet; the routes are the whole feature (FR-13).

// How many accounts a search returns at most
const SEARCH_LIMIT = 20;

// What the routes need from the database (MifDb implements it)
export interface AdminStore {
  searchUsers(text: string, limit: number, now: number): AdminUserRow[];
  getAccount(userId: number, now: number): AdminUserRow | undefined;
  blockUser(adminId: number, userId: number, reason: string, now: number): AdminUserRow | undefined;
  unblockUser(adminId: number, userId: number, now: number): AdminUserRow | undefined;
  endUserSessions(adminId: number, userId: number, now: number): number | undefined;
}

export interface AdminOptions {
  store: AdminStore;
  // Told when sessions end, so open live connections can be closed
  onSessionsEnded?: (ended: SessionsEnded) => void;
  now?: () => number;
}

type AdminResponse = Response<AdminUserResponse | AdminUsersResponse | AuthErrorResponse>;

function fail(res: AdminResponse, status: number, code: AuthErrorCode, error: string) {
  return res.status(status).json({ success: false, code, error });
}

const publicAccount = (row: AdminUserRow): AdminUser => ({
  id: row.id,
  email: row.email ?? '',
  role: row.role,
  createdAt: row.created_at,
  verifiedAt: row.verified_at,
  bannedAt: row.banned_at,
  banReason: row.ban_reason,
  sessions: row.sessions,
});

// Lets a request through only for an administrator. It stands behind requireSession, which
// reads the role from the database on every request: a role taken away stops working at once.
export function requireAdmin(): RequestHandler {
  return (_req, res: Response<AuthErrorResponse>, next) => {
    if (sessionUser(res)?.role === 'admin') return next();
    return res.status(403).json({
      success: false,
      code: 'forbidden',
      error: 'This is for administrators.',
    });
  };
}

export function createAdminRouter(
  { store, onSessionsEnded, now = Date.now }: AdminOptions,
  limits: Pick<RateLimits, 'adminPerMinute'>
): Router {
  const router = Router();
  router.use(limiter(limits.adminPerMinute), express.json());
  router.use((_req, res, next) => {
    // Answers about accounts must not be kept by a cache
    res.set('Cache-Control', 'no-store');
    next();
  });

  // The account a route acts on, by the id in its path. Answers 404 itself if there is none.
  function target(id: string | undefined, res: AdminResponse): AdminUserRow | undefined {
    const account = id && /^\d{1,15}$/.test(id) ? store.getAccount(Number(id), now()) : undefined;
    if (!account) fail(res, 404, 'not_found', 'There is no such account.');
    return account;
  }

  // Accounts whose address contains ?query=, at most 20.
  router.get('/users', (req, res: AdminResponse) => {
    const query = AdminUsersQuerySchema.safeParse(req.query);
    if (!query.success) return fail(res, 400, 'invalid_request', zodErrorMessage(query.error));
    const users = store.searchUsers(query.data.query, SEARCH_LIMIT, now());
    return res.json({ success: true, users: users.map(publicAccount) });
  });

  // Blocks an account: its sessions and live connections end at once and it cannot sign in.
  router.post('/users/:id/block', (req, res: AdminResponse) => {
    const body = BlockUserRequestSchema.safeParse(req.body);
    if (!body.success) return fail(res, 400, 'invalid_request', zodErrorMessage(body.error));
    const account = target(req.params.id, res);
    if (!account) return undefined;
    // Also keeps an administrator from locking themselves out
    if (account.role === 'admin') {
      return fail(
        res,
        400,
        'invalid_request',
        'An administrator cannot be blocked: take the address out of ADMIN_EMAILS first.'
      );
    }
    const admin = sessionUser(res)!;
    const blocked = store.blockUser(admin.id, account.id, body.data.reason, now());
    if (!blocked) return fail(res, 404, 'not_found', 'There is no such account.');
    onSessionsEnded?.({ userId: account.id });
    console.log(`Admin ${admin.id} blocked user ${account.id}`);
    return res.json({ success: true, user: publicAccount(blocked) });
  });

  router.post('/users/:id/unblock', (req, res: AdminResponse) => {
    const account = target(req.params.id, res);
    if (!account) return undefined;
    const admin = sessionUser(res)!;
    const unblocked = store.unblockUser(admin.id, account.id, now());
    if (!unblocked) return fail(res, 404, 'not_found', 'There is no such account.');
    console.log(`Admin ${admin.id} unblocked user ${account.id}`);
    return res.json({ success: true, user: publicAccount(unblocked) });
  });

  // Signs every browser of an account out, e.g. when its owner lost a device.
  router.post('/users/:id/sessions/end', (req, res: AdminResponse) => {
    const account = target(req.params.id, res);
    if (!account) return undefined;
    const admin = sessionUser(res)!;
    const ended = store.endUserSessions(admin.id, account.id, now());
    if (ended === undefined) return fail(res, 404, 'not_found', 'There is no such account.');
    onSessionsEnded?.({ userId: account.id });
    console.log(`Admin ${admin.id} ended ${ended} sessions of user ${account.id}`);
    return res.json({ success: true, user: publicAccount({ ...account, sessions: 0 }) });
  });

  return router;
}
