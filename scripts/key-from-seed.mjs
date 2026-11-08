// Turns the seed phrase of a THROWAWAY testnet account into the secret key Vercel needs.
// Usage: node scripts/key-from-seed.mjs   (type the phrase when asked; nothing is saved)
import { parseSeedPhrase } from 'near-api-js/seed-phrase';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl._writeToOutput = (s) => { if (!rl.stdoutMuted) rl.output.write(s); };
rl.question('Seed phrase of the testnet factory account: ', (phrase) => {
  rl.stdoutMuted = false; console.log('');
  try { const kp = parseSeedPhrase(phrase.trim()); console.log('Public key :', kp.getPublicKey().toString()); console.log('Secret key :', kp.toString()); console.log('\nPut the secret key in Vercel as NEAR_FACTORY_KEY (Sensitive). Never paste it anywhere else.'); }
  catch { console.log('That does not look like a valid seed phrase.'); }
  rl.close();
});
rl.stdoutMuted = true;
