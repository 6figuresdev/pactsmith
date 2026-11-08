import { createAppHandler } from '../../server/src/vercel.js';
import { makeStore } from '../../server/src/store.js';

export default createAppHandler({ store: makeStore(process.env), kind: 'manifest' });
