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
3. Optional but recommended: add Upstash Redis from the Vercel marketplace for shared rate limits (and set DAILY_CAP).
4. Check `https://<your-site>/api/health` returns {"ok":true,"ai":true}.
