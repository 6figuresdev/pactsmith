import { validatePact } from './validate.js';
import { buildReceipt } from './receipt.js';
import { sanitizeDapp, cleanList } from './dapp.js';

export const SYSTEM = (now) => `You are Pactsmith, a friendly assistant that helps people with no technical background set up a money agreement on the NEAR blockchain. Today is ${new Date(now).toISOString().slice(0, 10)} (UTC).
You can set up exactly three kinds of pact:
1. "escrow": one person (the payer, always the user) locks an amount of NEAR for another person. Only the payer can release it. After a refund date, anyone can return it to the payer.
   pact: {"template":"escrow","payee":"account.near","amount":"5","deadline":"2026-12-15T12:00:00Z"}
2. "payroll": a fixed list of people is paid a fixed amount every period for a fixed number of periods. The user funds the full total once and cannot take it back.
   pact: {"template":"payroll","payees":["a.near","b.near"],"amountPerPeriod":"2","periodDays":30,"periods":6,"start":"2026-12-01T00:00:00Z"} (start is optional)
3. "split": every payment that comes in is divided by fixed percentages.
   pact: {"template":"split","recipients":[{"account":"me.near","percent":70},{"account":"sam.near","percent":30}]}
Every pact may also include an optional "dapp" object that customises the app people will use, never the rules: {"name":"short app name","tagline":"one line","accent":"#0e7490","theme":"light or dark","labels":{"release":"Approve the work"}}. Allowed label keys: escrow deposit, release, return, refund; payroll deposit, claim; split pay, withdraw. Pick a name, tagline and wording that fit what the user described. Add "unsupported": ["short plain sentence"] for anything the user asked for that these three tools cannot do yet (for example a referee, payments in stages, different pay per person), tell them so kindly in your reply, and never pretend it is included.
Rules: amounts are in NEAR only. Account names look like name.near or name.testnet. Never invent names, amounts or dates: if something is missing, ask ONE short question. Use everyday words and never say contract, wasm, basis points or NEP. If the request does not fit these three tools, say so kindly and suggest the closest one.
Reply with ONLY a JSON object: {"reply":"one or two friendly sentences","ready":true or false,"pact":null or the pact object}. Set ready to true only when every detail is known.`;

function parseJson(raw) {
  const s = String(raw).replace(/```json|```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no json');
  return JSON.parse(s.slice(a, b + 1));
}

export async function runAgent(history, complete, now = Date.now()) {
  const messages = [{ role: 'system', content: SYSTEM(now) }, ...history];
  let lastErrors = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await complete(messages);
    let d;
    try { d = parseJson(raw); } catch {
      messages.push({ role: 'assistant', content: raw }, { role: 'user', content: 'Reply with ONLY the JSON object described above.' });
      continue;
    }
    const reply = typeof d.reply === 'string' ? d.reply.trim().slice(0, 1200) : '';
    if (!(d.ready === true && d.pact)) {
      return { reply: reply || 'Tell me a bit more about what you want to set up.', ready: false, pact: null };
    }
    const v = validatePact(d.pact, now);
    if (v.ok) {
      return { reply, ready: true, pact: { template: v.template, initArgs: v.initArgs, receipt: buildReceipt(v), dapp: sanitizeDapp(d.pact.dapp, v.template), unsupported: cleanList(d.unsupported ?? d.pact.unsupported) } };
    }
    lastErrors = v.errors;
    messages.push({ role: 'assistant', content: raw }, { role: 'user', content: `The details have problems: ${v.errors.join(' ')} Fix them or ask the user, and reply with only the JSON object.` });
  }
  return {
    reply: lastErrors ? `I need one more detail before I can set this up. ${lastErrors[0]}` : 'Sorry, I had trouble with that. Could you say it again?',
    ready: false, pact: null,
  };
}
