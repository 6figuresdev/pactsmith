// Shows which public key a seed phrase or secret key belongs to, and whether it matches the account.
// Nothing is saved or sent anywhere.
// Usage: node scripts/check-key.mjs ed25519:EXPECTED_PUBLIC_KEY
import { KeyPair } from 'near-api-js';
import { parseSeedPhrase } from 'near-api-js/seed-phrase';
import readline from 'node:readline';

const expected = process.argv[2] || '';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl._writeToOutput = (s) => { if (!rl.muted) rl.output.write(s); };
rl.question('Paste the seed phrase OR the secret key (hidden): ', (v) => {
  rl.muted = false; console.log('');
  try {
    const t = v.trim();
    const kp = t.startsWith('ed25519:') ? KeyPair.fromString(t) : parseSeedPhrase(t);
    const pub = kp.getPublicKey().toString();
    console.log('Public key:', pub);
    if (expected) console.log(pub === expected ? 'MATCH: this is the right key for the account.' : 'NO MATCH: this is not the key registered on the account.');
    if (!expected || pub === expected) console.log('Secret key:', kp.toString());
  } catch { console.log('That is not a valid seed phrase or secret key.'); }
  rl.close();
});
rl.muted = true;
