import { createHealthHandler } from '../server/src/vercel.js';
import { makeLimiter } from '../server/src/limits.js';

export default createHealthHandler({ limiter: makeLimiter(process.env) });
