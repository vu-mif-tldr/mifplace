import type { RequestHandler, Response } from 'express';
import type { AuthErrorResponse } from '@mifplace/shared';
import { isAllowedOrigin } from '../origin.js';
import type { Sessions, SessionUser } from './sessions.js';

// What stands in front of the routes: who may call them and from where.

// The session cookie is sent by the browser on its own, so a request that changes something
// must come from our page (the Origin header), not from a form on another site.
export function sameOrigin(allowedOrigins: readonly string[]): RequestHandler {
  return (req, res: Response<AuthErrorResponse>, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (isAllowedOrigin(req.headers.origin, req.headers.host, allowedOrigins)) return next();
    return res.status(403).json({
      success: false,
      code: 'forbidden_origin',
      error: 'This request must come from the page itself.',
    });
  };
}

// Lets a request through only with a session; the routes after it find the user with
// sessionUser(). A blocked user has no session. Answered before the per-route limits: the
// check is one lookup by primary key, cheaper than counting the request.
export function requireSession(sessions: Sessions): RequestHandler {
  return (req, res: Response<AuthErrorResponse>, next) => {
    const user = sessions.authenticate(req.headers.cookie);
    if (!user) {
      return res
        .status(401)
        .json({ success: false, code: 'unauthenticated', error: 'Not signed in.' });
    }
    res.locals.user = user;
    return next();
  };
}

// The signed-in user of the request, set by requireSession. Undefined on a route that is
// not behind it.
export function sessionUser(res: Response): SessionUser | undefined {
  return res.locals.user as SessionUser | undefined;
}
