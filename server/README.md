# Pactsmith server

Zero dependencies (Node 20.6+). The AI only proposes; `src/validate.js` decides.

- POST /api/chat  { "messages": [{ "role": "user", "content": "..." }] }
  -> { reply, ready, pact: { template, initArgs, receipt } | null }
- GET  /api/health

`initArgs` match the `new` function of each contract. Two markers are filled in at deploy time:
`{{wallet}}` (the connected account) and `{{now_ns}}` (the current time in nanoseconds).

## Run

    cd server
    cp .env.example .env     # then add your key
    node --test              # 19 tests, no key needed
    npm start

Keep the AI key in `server/.env` only. Never put it in the website.
