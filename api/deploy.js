import { createDeployHandler } from '../server/src/vercel.js';
import { makeLimiter } from '../server/src/limits.js';
import { makeStore } from '../server/src/store.js';

export default createDeployHandler({ store: makeStore(process.env), limiter: makeLimiter(process.env) });
