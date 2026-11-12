import type { Db } from '../db/client.js';
import type { Role, User } from '../domain/types.js';

const map = (r: Record<string, unknown>): User => ({
  id: String(r.id),
  email: String(r.email),
  name: String(r.name),
  role: r.role as Role,
  createdAt: String(r.created_at),
});

export const usersRepo = (db: Db) => ({
  async findById(id: string): Promise<User | null> {
    const r = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
    return r.rows[0] ? map(r.rows[0]) : null;
  },
  async findByEmail(email: string): Promise<User | null> {
    const r = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
    return r.rows[0] ? map(r.rows[0]) : null;
  },
  async create(u: User): Promise<void> {
    await db.execute({
      sql: 'INSERT INTO users (id,email,name,role,created_at) VALUES (?,?,?,?,?)',
      args: [u.id, u.email, u.name, u.role, u.createdAt],
    });
  },
});
