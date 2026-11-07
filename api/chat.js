import { createHandler } from '../server/src/vercel.js';
import { makeProvider } from '../server/src/provider.js';
import { makeLimiter } from '../server/src/limits.js';

let complete;
export default createHandler({
  getComplete: () => (complete ??= makeProvider(process.env)),
  limiter: makeLimiter(process.env),
});
