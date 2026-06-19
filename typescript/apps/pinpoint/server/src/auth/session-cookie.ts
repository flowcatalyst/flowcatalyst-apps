import type { FastifyReply } from 'fastify';

export const SESSION_COOKIE_NAME = 'pp_session';

export interface SessionCookieOptions {
  /** Mark Secure (HTTPS-only). Default true; flipped to false for local-HTTP dev. */
  readonly secure: boolean;
}

export function setSessionCookie(
  reply: FastifyReply,
  sessionId: string,
  options: SessionCookieOptions = { secure: true },
): void {
  reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secure,
  });
}

export function clearSessionCookie(
  reply: FastifyReply,
  options: SessionCookieOptions = { secure: true },
): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: options.secure,
  });
}
