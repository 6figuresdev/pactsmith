# Pactsmith contracts

Three small NEAR contracts written from scratch (near-sdk 5). Not audited. NEAR only for now.

- pactsmith-escrow  - hold funds until the payer approves; refund after a deadline
- pactsmith-payroll - fixed team, fixed pay per period, funded once, payees pull
- pactsmith-split   - divide every payment by fixed basis points

Test each one on a clean machine with Rust installed:

    cd pactsmith-escrow && cargo test
    cd ../pactsmith-payroll && cargo test
    cd ../pactsmith-split && cargo test

Build for deployment (needs cargo-near): cargo near build

## Layout

    contracts/   escrow, payroll, split (Cargo workspace; run `cargo test` at the root)
    public/      index.html, the website and builder (static, no build step)
    api/         Vercel serverless functions (chat, health)
    server/      shared backend code + local server + tests

## Testing

1. Unit tests (fast, no network needed after the first download):  `cargo test --lib`
2. Real-runtime sandbox tests (start a local NEAR network):
       rustup update stable
       ./build-wasm.sh
       cargo test --tests
   The first run downloads the NEAR sandbox binary.

## Server

`server/` is the backend (see server/README.md). Test it with `cd server && node --test`.

## Deploy to Vercel

1. `npx vercel login` (use email), then `npx vercel` from this folder, then `npx vercel --prod`.
2. In the Vercel dashboard add environment variables: PROVIDER=groq and GROQ_API_KEY (mark as sensitive), then redeploy.
3. Add Upstash Redis from the Vercel marketplace (Storage -> Upstash Redis -> connect to the project). It is REQUIRED for app links (builds are stored there for 90 days) and gives shared rate limits. Optionally set DAILY_CAP.
4. Check `https://<your-site>/api/health` returns {"ok":true,"ai":true}.

## Testnet launch (wallet + deploy)

1. `./build-wasm.sh && scripts/collect-wasm.sh`, then commit `server/wasm/*.wasm`.
2. Create a dedicated THROWAWAY testnet account (the "factory") and fund it with the faucet. Each launch costs about 2 NEAR of testnet storage.
3. In Vercel set NEAR_FACTORY_ACCOUNT and NEAR_FACTORY_KEY (Sensitive). `node scripts/key-from-seed.mjs` turns the account's seed phrase into the key.
4. `/api/health` should show ai, launch and wasm all true.
5. Optional real-network check: `NEAR_FACTORY_ACCOUNT=... NEAR_FACTORY_KEY=... npm run smoke`.

## Download your build

Every app has a "Download your build" button (`/app/<id>/package.zip`): contract source, tests, the exact settings, a deploy script and a testnet-first README. Run `scripts/collect-wasm.sh` after changing a contract so `server/templates` stays in sync (a test enforces this).
