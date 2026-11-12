import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import { isUniqueViolation } from '../db/client.js';
import type { User } from '../domain/types.js';
import { Errors } from '../domain/errors.js';
import type { usersRepo } from '../repositories/users.js';

const secret = () => new TextEncoder().encode(config.jwtSecret);

/**
 * Mock authentication: email-only "login" that creates the account on first use.
 * Deliberately isolated behind issueToken/verifyToken so a real IdP (Clerk/Auth0/OTP) can replace `login`.
 */
export const authService = (users: ReturnType<typeof usersRepo>, clock: () => Date) => ({
  async login(email: string, name?: string): Promise<{ token: string; user: User }> {
    const normalized = email.trim().toLowerCase();
    let user = await users.findByEmail(normalized);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        email: normalized,
        name: name?.trim() || normalized.split('@')[0] || normalized,
        role: config.adminEmails.includes(normalized) ? 'admin' : 'user',
        createdAt: clock().toISOString(),
      };
      try {
        await users.create(user);
      } catch (e) {
        // Two first logins raced on the same email: the other one created the account, so use it.
        const existing = isUniqueViolation(e) ? await users.findByEmail(normalized) : null;
        if (!existing) throw e;
        user = existing;
      }
    }
    const token = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret());
    return { token, user };
  },

  /** Returns the live user from the DB (role changes/deletions take effect immediately). */
  async authenticate(token: string): Promise<User> {
    try {
      const { payload } = await jwtVerify(token, secret());
      const user = payload.sub ? await users.findById(payload.sub) : null;
      if (!user) throw Errors.unauthenticated();
      return user;
    } catch {
      throw Errors.unauthenticated();
    }
  },
});
