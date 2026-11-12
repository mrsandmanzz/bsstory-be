import { getContainer } from '../container.js';

const c = await getContainer();
console.log('Database migrated and seeded (if empty).');
c.db.close();
