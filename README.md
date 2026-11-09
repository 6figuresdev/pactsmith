# Pactsmith

**Describe a money agreement in plain English. Pactsmith builds it as a working app on the NEAR blockchain, lets you try it safely, and launches it with one click.**

> **Status: testnet beta. Unaudited software. Do not use real money.**
> Live testnet beta: https://pactsmith-umber.vercel.app

---

## The problem

Moving money under conditions is a daily need, and it is hard to do without trusting someone:

- A client wants to pay a freelancer **only when the work is approved**.
- A small team wants to pay people **the same amount on a schedule**, without chasing invoices.
- Collaborators want to **share income by fixed percentages**, without one person holding all the money.

Today people choose between three bad options:

1. **A middleman or platform.** It holds the money, charges fees, can freeze accounts, and decides disputes.
2. **Trusting each other.** It works until it doesn't.
3. **A custom smart contract.** It removes the middleman, but it needs a developer, costs time and money, and money-handling code is easy to get wrong. A person with no coding knowledge cannot check it.

Pactsmith gives people the benefits of smart contracts, with code that holds the funds and enforces the rules, without needing to write or read code.

## What it does

1. **Chat.** You describe what you want. The assistant asks short questions until it has the people, amounts and dates.
2. **Strict check.** The AI only *proposes*. A strict checker decides what is acceptable, and the server writes the plain-English summary of the deal. The AI never writes contract code.
3. **A hosted app for every build.** Each build gets its own link, such as `/app/abc123`, with its own name, wording and colors. It can be installed from Chrome as an app.
4. **Sandbox.** Everyone can practise the exact rules with pretend money before anything is created.
5. **Launch on testnet.** The builder connects a NEAR wallet and presses one button. One transaction creates the contract, funds its storage, deploys the code and sets it up. **No access key is added, so nobody can ever change it.** The server then checks the code on-chain against the expected fingerprint.
6. **Live app.** After launch the same page runs the real contract through the user's wallet.
7. **Download your build.** A zip with the contract source, tests, the exact settings, a deploy script and a testnet-first README.

## The three tools

| Tool | What it does |
|---|---|
| **Escrow** | The payer locks an exact amount once. Only the payer can release it to the payee. The payee can hand it back at any time. After a deadline, anyone can return it to the payer. |
| **Payroll vault** | A fixed team is paid a fixed amount each period, for a fixed number of periods. The funder puts in the full total once and cannot take it back. People collect their own pay. |
| **Revenue split** | Every payment is divided by fixed percentages. People withdraw their own share. |

None of the contracts has an owner, admin or setter. If a payout transfer fails, the contract restores the balance so funds are never stranded.

## How it is built

```
public/            the website and the installable app shell
api/               Vercel functions: chat, deploy, health, app/[id], manifest/[id], package/[id]
server/src/        agent, validator, receipts, app page, store, limits, NEAR launch, package builder
server/test/       backend tests (zero dependencies, Node's built-in test runner)
server/wasm/       the compiled contracts (committed, so the server can deploy them)
server/templates/  contract sources, used for the "Download your build" package
contracts/         the Rust contracts: escrow, payroll, split
scripts/           wasm collection, real-testnet smoke test, key helpers
.github/workflows/ automatic tests on every push
```

Stack: Rust and `near-sdk` for the contracts; Node 22 with no runtime packages for the backend, except `near-api-js` (pinned) for the testnet launch; Vercel for hosting and functions; Upstash Redis for saved builds and rate limits; Groq (or xAI Grok) for the AI, called only from the server; NEAR Connect for wallets.

## Security model

- **The AI never writes contract code.** It picks one of the fixed templates and fills in the terms. Everything it proposes is validated: account names, amounts, dates, duplicates, share totals and limits.
- **The server writes the plain-English summary** from the validated numbers, so the AI cannot misdescribe a deal.
- **Customization is cosmetic.** The AI can choose the app's name, colors and button wording. It cannot change the rules.
- **Only the builder can launch a build.** Each build has a secret owner key. Only its hash is stored. Without this, anyone with the link could launch first and become the payer.
- **Contracts are keyless.** The launch transaction never adds a key.
- **Secrets stay on the server.** AI and NEAR keys live only in environment variables. The website never sees them.
- **Abuse limits.** Per-address rate limits and a daily cap, shared through Redis, plus request-size and input checks. Other websites are refused by an origin check.
- **The testnet factory account** pays launch fees on testnet only. Real money only ever moves through the user's own wallet.

## Run it yourself

**Requirements:** Node 22 or newer, Rust (stable), a NEAR testnet wallet.

```bash
# backend tests (no key needed)
cd server && node --test

# run the backend locally
cd server && cp .env.example .env     # add your AI key
npm start

# contract tests
cargo test --lib                      # fast unit tests
rustup update stable
./build-wasm.sh                       # builds the wasm with cargo-near
cargo test --tests                    # real-runtime tests on a local NEAR network
scripts/collect-wasm.sh               # copies wasm + sources into server/ (commit the result)
```

**Real-network check** (launches an escrow on testnet and runs fund, release, and balance checks):

```bash
NEAR_FACTORY_ACCOUNT=<testnet account> NEAR_FACTORY_KEY=<its secret key> npm run smoke
```

### Deploy to Vercel

1. Push the repository to GitHub and import it in Vercel. Every push to `main` redeploys.
2. Add **Upstash Redis** from Vercel's Storage tab (required for app links and shared rate limits).
3. Set the environment variables below, then redeploy.
4. Check `/api/health`, and `/api/health?check=launch` for the testnet factory setup.

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | The AI key (Sensitive). `PROVIDER=xai` with `XAI_API_KEY` and `MODEL` switches to Grok |
| `MODEL` | Optional model name (defaults to `openai/gpt-oss-120b` on Groq) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Added by the Redis integration (the `KV_REST_API_*` names also work) |
| `NEAR_FACTORY_ACCOUNT` | A dedicated, throwaway testnet account that pays launch fees |
| `NEAR_FACTORY_KEY` | That account's secret key (Sensitive). Never use a real wallet's key |
| `NEAR_RPC_URL` | Optional. Defaults to FastNear's testnet endpoint |
| `NEAR_PACT_EXTRA_NEAR` | Optional spare balance per launch (default 0.5, allowed 0.1 to 2) |
| `RATE_LIMIT_PER_MIN`, `DAILY_CAP` | Optional abuse limits (defaults 20 and 500) |

### Endpoints

| Route | Purpose |
|---|---|
| `POST /api/chat` | The assistant. Returns a question, or a validated pact with a link |
| `POST /api/deploy` | Owner-only testnet launch |
| `GET /app/:id` | The hosted app for a build |
| `GET /app/:id/package.zip` | Download your build |
| `GET /api/health` | Status. Add `?check=launch` to test the factory setup |

## Testing

- 49 backend tests, covering the checker, the agent loop, the launch (including attack cases), the hosted pages and the download package.
- 22 contract unit tests and 17 real-runtime tests that run the compiled contracts on a local NEAR network.
- A real-testnet smoke test that launches an escrow and checks real balances.
- GitHub Actions runs the backend and contract unit tests on every push.

## Limits today

- **Testnet only, and unaudited.** A professional audit is required before any mainnet use.
- Amounts are in **NEAR only**. USDC is planned.
- Payroll pays the same amount to everyone. Escrow has a single payer, a single payee and no referee. Both are being extended.
- Revenue-split payments must use the app's pay-in button. A plain transfer to the contract is not tracked.
- The AI works only within the three tools. Anything else is reported as "not supported yet" instead of being faked.

## Roadmap

1. Escrow with an optional referee and payments in stages.
2. Payroll with a different amount per person.
3. USDC support.
4. Plan editing in the chat, an activity log in each app, and mobile polish.
5. A professional audit, then a mainnet checklist.

