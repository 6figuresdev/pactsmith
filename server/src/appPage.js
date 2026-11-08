// Renders the hosted app for one build. Everything user-controlled is escaped or set with textContent.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function client() {
  var S = JSON.parse(document.getElementById('spec').textContent), t = S.template, a = S.initArgs, L = S.dapp.labels;
  var $ = function (s) { return document.querySelector(s); };
  var el = function (tag, c, x) { var e = document.createElement(tag); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  var Y = 1000000000000000000000000n;
  var near = function (y) { y = BigInt(y); var w = y / Y, f = (y % Y).toString().padStart(24, '0').replace(/0+$/, ''); return f ? w + '.' + f : String(w); };
  var app = $('#app');
  var card = function (title) { var c = el('section', 'card'); if (title) c.appendChild(el('h2', null, title)); app.appendChild(c); return c; };
  var top = el('header', 'top'); top.appendChild(el('h1', null, S.dapp.name)); if (S.dapp.tagline) top.appendChild(el('p', 'tag', S.dapp.tagline));
  top.appendChild(el('span', 'badge', 'Testnet sandbox. Pretend money only.')); app.appendChild(top);

  var id = S.id, OWNER = '';
  try { var mm = /owner=([A-Za-z0-9_-]+)/.exec(location.hash); if (mm) { localStorage.setItem('pm-owner-' + id, mm[1]); history.replaceState(null, '', location.pathname); } OWNER = localStorage.getItem('pm-owner-' + id) || ''; } catch (e) {}
  var NC = null, wallet = null, account = '';
  var w = card('Wallet'); var wrow = el('div', 'acts'); w.appendChild(wrow);
  var cw = el('button', 'btn', 'Connect wallet'); wrow.appendChild(cw);
  var copy = el('button', 'btn ghost', 'Copy link'); copy.onclick = function () { navigator.clipboard && navigator.clipboard.writeText(location.origin + location.pathname).then(function () { copy.textContent = 'Link copied'; }); }; wrow.appendChild(copy);
  var inst = el('button', 'btn ghost', 'Install as an app'); inst.hidden = true; wrow.appendChild(inst);
  var wmsg = el('p', 'mut', 'Connect a NEAR testnet wallet to launch and use this app. Testnet money has no real value.'); w.appendChild(wmsg);
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); inst.hidden = false; inst.onclick = function () { e.prompt(); }; });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  var launch = card('Launch on testnet'), live = card('Live on testnet'); live.hidden = true; launch.hidden = true;

  var getConnector = async function () {
    if (NC) return NC;
    var Mod = window.__NC ? { NearConnector: window.__NC } : await import('https://esm.sh/@hot-labs/near-connect@0.11.1');
    NC = new Mod.NearConnector({ network: 'testnet' });
    NC.on('wallet:signOut', function () { account = ''; wallet = null; paint(); });
    return NC;
  };
  cw.onclick = async function () {
    if (account) { try { await NC.disconnect(); } catch (e) {} account = ''; wallet = null; paint(); return; }
    wmsg.textContent = 'Opening your wallet…';
    try { var c = await getConnector(); wallet = await c.connect(); var accs = await wallet.getAccounts(); account = accs && accs[0] && accs[0].accountId || ''; wmsg.textContent = ''; }
    catch (e) { wmsg.textContent = 'Could not connect: ' + ((e && e.message) || 'cancelled') + '. Try again.'; }
    paint();
  };

  var rpcView = async function (cid, method, args) {
    var r = await fetch(S.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'v', method: 'query', params: { request_type: 'call_function', finality: 'optimistic', account_id: cid, method_name: method, args_base64: btoa(JSON.stringify(args || {})) } }) });
    var j = await r.json(); if (!j.result || !j.result.result) throw new Error('view failed');
    return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
  };
  var toY = function (v) { var m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(v).trim()); if (!m) return null; var y = BigInt(m[1]) * Y + BigInt((m[2] || '').padEnd(24, '0')); return y > 0n ? y : null; };

  var paint = function () {
    cw.textContent = account ? 'Disconnect ' + account : 'Connect wallet';
    launch.innerHTML = ''; launch.appendChild(el('h2', null, 'Launch on testnet'));
    if (S.deployed) { launch.hidden = true; } else {
      launch.hidden = false;
      launch.appendChild(el('p', 'mut', 'Launching creates this contract on the NEAR testnet in one step. It has no owner and no keys, so nobody can change its rules afterwards. Pactsmith pays the testnet fees. Your wallet becomes the ' + (t === 'escrow' ? 'payer' : t === 'payroll' ? 'funder' : 'launcher') + '.'));
      var msg = el('div', 'log', '');
      if (!account) msg.textContent = 'Connect your wallet first.';
      else if (!OWNER) msg.textContent = 'Only the person who built this app can launch it. Open the link you were given when you built it.';
      else { var go = el('button', 'btn', 'Create on testnet'); go.onclick = async function () {
          go.disabled = true; msg.textContent = 'Creating your contract… this takes about 10 seconds.';
          try { var r = await fetch('/api/deploy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id, wallet: account, owner: OWNER }) }); var j = await r.json();
            if (r.ok || j.deployed) { S.deployed = j.deployed; paint(); return; } msg.textContent = (j.error || 'The launch failed. Please try again.') + (j.reason ? ' (code: ' + j.reason + ')' : ''); }
          catch (e) { msg.textContent = 'Could not reach Pactsmith. Check your connection and try again.'; }
          go.disabled = false; };
        launch.appendChild(go); }
      launch.appendChild(msg);
    }
    live.innerHTML = ''; live.hidden = !S.deployed; if (!S.deployed) return;
    var D = S.deployed, cid = D.contractId;
    live.appendChild(el('h2', null, 'Live on testnet'));
    var kv = function (k, v, href) { var r = el('div', 'kv'); r.appendChild(el('span', null, k)); var b = href ? el('a', null, v) : el('b', null, v); if (href) { b.href = href; b.target = '_blank'; b.rel = 'noopener'; b.style.fontWeight = '700'; } r.appendChild(b); live.appendChild(r); };
    kv('Contract', cid, 'https://testnet.nearblocks.io/address/' + cid); kv('Code fingerprint', D.codeHash.slice(0, 12) + '…'); kv('Keys on the contract', 'None. Nobody can change it.');
    var role = !account ? 'Connect your wallet to take part.' : account === D.payer ? 'You are connected as ' + account + ' (the ' + (t === 'escrow' ? 'payer' : t === 'payroll' ? 'funder' : 'launcher') + ').' : t === 'escrow' && account === a.payee ? 'You are connected as ' + account + ' (the payee).' : 'You are connected as ' + account + '.';
    live.appendChild(el('p', 'mut', role));
    var lst = el('div', 'pill', 'Reading the contract…'), llog = el('div', 'log', ''), lacts = el('div', 'acts');
    var refresh = async function () { try {
        if (t === 'escrow') lst.textContent = 'Status: ' + (await rpcView(cid, 'get_status'));
        else if (t === 'payroll') lst.textContent = account ? 'You can collect ' + near(await rpcView(cid, 'get_claimable', { account: account })) + ' NEAR right now.' : 'Connect a wallet to see what you can collect.';
        else lst.textContent = account ? 'You have ' + near(await rpcView(cid, 'get_pending', { account: account })) + ' NEAR waiting.' : 'Connect a wallet to see your share.';
      } catch (e) { lst.textContent = 'Could not read the contract right now.'; } };
    var send = async function (method, deposit) {
      if (!wallet) { llog.textContent = 'Connect your wallet first.'; return; }
      llog.textContent = 'Waiting for your wallet…';
      try { await wallet.signAndSendTransaction({ receiverId: cid, actions: [{ type: 'FunctionCall', params: { methodName: method, args: {}, gas: '100000000000000', deposit: String(deposit || '0') } }] }); llog.textContent = 'Done. Checking the result…'; await refresh(); llog.textContent = 'Done.'; }
      catch (e) { llog.textContent = 'It did not go through: ' + ((e && e.message) || 'cancelled'); } };
    var lb = function (label, fn) { var b = el('button', 'btn', label); b.onclick = fn; lacts.appendChild(b); };
    if (t === 'escrow') { lb(L.deposit, function () { send('deposit', a.amount); }); lb(L.release, function () { send('release'); }); lb(L.return, function () { send('return_to_payer'); }); lb(L.refund, function () { send('refund'); }); }
    else if (t === 'payroll') { lb(L.deposit, function () { send('deposit', BigInt(a.amount) * BigInt(a.payees.length) * BigInt(a.periods)); }); lb(L.claim, function () { send('claim'); }); }
    else { var amt = el('input'); amt.value = '1'; amt.setAttribute('aria-label', 'Payment in NEAR'); lacts.appendChild(amt); lb(L.pay, function () { var y = toY(amt.value); if (!y) { llog.textContent = 'Enter a payment above zero, like 1 or 2.5.'; return; } send('deposit', y); }); lb(L.withdraw, function () { send('withdraw'); }); }
    live.appendChild(lst); live.appendChild(lacts); live.appendChild(llog); refresh();
  };
  paint();

  var about = card('What this does'); var ul = el('ul'); S.receipt.lines.forEach(function (l) { ul.appendChild(el('li', null, l)); }); about.appendChild(ul);
  if (S.unsupported && S.unsupported.length) { var nb = el('div', 'note', 'Not supported yet: ' + S.unsupported.join('; ')); about.appendChild(nb); }
  var det = card('Details'); S.receipt.facts.forEach(function (f) { var r = el('div', 'kv'); r.appendChild(el('span', null, f.label)); r.appendChild(el('b', null, f.value)); det.appendChild(r); });
  var dl = card('Take it with you'); dl.appendChild(el('p', 'mut', 'Download the contract source, its tests, your exact settings, a deploy script and a step-by-step README. Testnet first. This software is unaudited, so do not put real money in it.'));
  var dla = el('a', 'btn ghost', 'Download your build \u2193'); dla.href = location.pathname.replace(/\/$/, '') + '/package.zip'; dla.setAttribute('download', ''); dla.style.display = 'inline-block'; dla.style.textDecoration = 'none'; dla.style.marginTop = '14px'; dl.appendChild(dla);
  var sb = card('Try it'); sb.appendChild(el('p', 'mut', 'This sandbox follows the exact rules of the pact, with pretend money. Pick who is acting, then press a button.'));

  var who = el('select'); var log = el('div', 'log', 'Pick who is acting, then try an action.'), status = el('div', 'pill');
  var addWho = function (v, label) { var o = el('option', null, 'Acting as ' + label); o.value = v; who.appendChild(o); };
  var btns = el('div', 'acts'); var addBtn = function (label, fn) { var b = el('button', 'btn', label); b.onclick = fn; btns.appendChild(b); return b; };
  sb.appendChild(who); sb.appendChild(btns); sb.appendChild(status); sb.appendChild(log);

  if (t === 'escrow') {
    var st = { s: 'created', late: false }, amt = near(a.amount), payee = a.payee;
    addWho('payer', 'You (the payer)'); addWho('payee', payee); addWho('anyone', 'Anyone else');
    var draw = function () { status.textContent = 'Status: ' + st.s + '. Refund date ' + (st.late ? 'has passed.' : 'not reached yet.'); };
    var act = function (k) { var x = who.value, m;
      if (k === 'deposit') m = st.s !== 'created' ? 'Rejected: it is already funded.' : x !== 'payer' ? 'Rejected: only the payer can fund it.' : (st.s = 'funded', 'Funded with ' + amt + ' NEAR.');
      else if (st.s !== 'funded') m = 'Rejected: nothing is funded yet.';
      else if (k === 'release') m = x !== 'payer' ? 'Rejected: only the payer can release it.' : (st.s = 'released', amt + ' NEAR goes to ' + payee + '.');
      else if (k === 'return') m = x !== 'payee' ? 'Rejected: only ' + payee + ' can hand it back.' : (st.s = 'refunded', 'The money returns to the payer.');
      else m = !st.late ? 'Rejected: the refund date has not passed yet.' : (st.s = 'refunded', 'Refunded to the payer.');
      log.textContent = m; draw(); };
    ['deposit', 'release', 'return', 'refund'].forEach(function (k) { addBtn(L[k], function () { act(k); }); });
    var tg = addBtn('Pretend the refund date has passed', function () { st.late = !st.late; tg.textContent = st.late ? 'Pretend it has not passed' : 'Pretend the refund date has passed'; draw(); }); tg.className = 'btn ghost'; draw();
  } else if (t === 'payroll') {
    var people = a.payees, n = a.periods, pay = near(a.amount), total = BigInt(a.amount) * BigInt(people.length) * BigInt(n);
    var days = Number(BigInt(a.period_ns) / 86400000000000n), ps = { funded: false, elapsed: 0, claimed: {} };
    people.forEach(function (p) { ps.claimed[p] = 0; });
    addWho('funder', 'You (the funder)'); people.forEach(function (p) { addWho(p, p); });
    var drawP = function () { status.textContent = (ps.funded ? 'Funded. ' : 'Not funded yet. ') + 'Pay period ' + ps.elapsed + ' of ' + n + ' (each is ' + days + ' day' + (days === 1 ? '' : 's') + ').'; };
    addBtn(L.deposit, function () { var x = who.value; log.textContent = ps.funded ? 'Rejected: already funded.' : x !== 'funder' ? 'Rejected: only the funder can fund it.' : (ps.funded = true, 'Funded with the full ' + near(total) + ' NEAR. It can not be taken back.'); drawP(); });
    addBtn(L.claim, function () { var x = who.value;
      if (!ps.funded) log.textContent = 'Rejected: not funded yet.'; else if (x === 'funder') log.textContent = 'Rejected: the funder is not on the pay list.';
      else { var due = ps.elapsed - ps.claimed[x]; if (due <= 0) log.textContent = 'Nothing to collect yet.'; else { ps.claimed[x] += due; log.textContent = x + ' collects ' + near(BigInt(a.amount) * BigInt(due)) + ' NEAR.'; } } drawP(); });
    var nx = addBtn('Pass one pay period', function () { if (ps.elapsed < n) ps.elapsed++; drawP(); }); nx.className = 'btn ghost'; drawP();
  } else {
    var accts = a.accounts, bps = a.bps, pend = accts.map(function () { return 0n; });
    addWho('anyone', 'Anyone'); accts.forEach(function (x) { addWho(x, x); });
    var amtIn = el('input'); amtIn.value = '10'; amtIn.setAttribute('aria-label', 'Payment in NEAR'); btns.appendChild(amtIn);
    var table = el('div', 'tbl'); sb.appendChild(table);
    var drawS = function () { table.innerHTML = ''; accts.forEach(function (x, i) { var r = el('div', 'kv'); r.appendChild(el('span', null, x + ' (' + (bps[i] / 100) + '%)')); r.appendChild(el('b', null, near(pend[i]) + ' NEAR waiting')); table.appendChild(r); }); };
    addBtn(L.pay, function () { var m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amtIn.value.trim()); if (!m || amtIn.value.trim() === '0') { log.textContent = 'Enter a payment above zero, like 10 or 2.5.'; return; }
      var y = BigInt(m[1]) * Y + BigInt((m[2] || '').padEnd(24, '0')), given = 0n; if (y === 0n) { log.textContent = 'Enter a payment above zero.'; return; }
      accts.forEach(function (_, i) { var part = i === accts.length - 1 ? y - given : y * BigInt(bps[i]) / 10000n; pend[i] += part; given += part; });
      log.textContent = near(y) + ' NEAR was divided between everyone.'; drawS(); });
    addBtn(L.withdraw, function () { var i = accts.indexOf(who.value); if (i < 0) log.textContent = 'Rejected: only the people on the list can withdraw.'; else if (pend[i] === 0n) log.textContent = 'Nothing to withdraw yet.'; else { log.textContent = accts[i] + ' withdraws ' + near(pend[i]) + ' NEAR.'; pend[i] = 0n; } drawS(); });
    drawS();
  }
  app.appendChild(el('p', 'foot', 'Pactsmith testnet beta. Unaudited software, no real money. Built with Pactsmith.'));
}

const CSS = `*{box-sizing:border-box}body{margin:0;font:17px/1.6 Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--fg)}
.light{--bg:#f6f7fb;--card:#fff;--fg:#0f172a;--mut:#475569;--line:#e5e7f0}.dark{--bg:#0d1020;--card:#161b38;--fg:#e8ecf7;--mut:#a3adc8;--line:#262d52}
#app{max-width:760px;margin:0 auto;padding:24px 20px 56px}.top{padding:28px 0 8px}h1{margin:0;font-size:clamp(30px,6vw,44px);letter-spacing:-.025em;line-height:1.1}
.tag{margin:10px 0 0;color:var(--mut);font-size:19px}.badge{display:inline-block;margin-top:16px;padding:5px 14px;border-radius:999px;background:var(--accent);color:#fff;font-size:14px;font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-top:18px;box-shadow:0 6px 24px rgba(30,30,80,.06)}h2{margin:0 0 12px;font-size:20px}
ul{margin:0;padding-left:22px}li{margin-bottom:8px}.mut{color:var(--mut);margin:10px 0 0;font-size:15.5px}.kv{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-bottom:1px solid var(--line);font-size:16px}.kv:last-child{border-bottom:0}.kv span{color:var(--mut)}.kv b{text-align:right}
.acts{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.btn{border:0;border-radius:10px;padding:12px 20px;background:var(--accent);color:#fff;font:600 16px inherit;font-family:inherit;cursor:pointer}.btn[disabled]{opacity:.5;cursor:not-allowed}.btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
select,input{font:16px inherit;font-family:inherit;padding:11px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);max-width:100%}input{width:110px}
.pill{display:inline-block;padding:6px 14px;border-radius:999px;background:var(--bg);border:1px solid var(--line);font-size:15px;margin-top:4px}.log{margin-top:14px;min-height:28px;font-weight:500}.note{margin-top:14px;padding:12px 16px;border-radius:10px;background:#fffbeb;border:1px solid #fde68a;color:#78350f;font-size:15px}.foot{margin-top:28px;text-align:center;color:var(--mut);font-size:14px}`;

export function renderApp(b, id, opts = {}) {
  const d = b.dapp;
  const dep = b.deployed ? { network: b.deployed.network, contractId: b.deployed.contractId, codeHash: b.deployed.codeHash, payer: b.deployed.payer, txHash: b.deployed.txHash, at: b.deployed.at } : null;
  const data = JSON.stringify({ id, template: b.template, initArgs: b.initArgs, receipt: b.receipt, dapp: d, unsupported: b.unsupported || [], deployed: dep, rpc: opts.rpc || 'https://test.rpc.fastnear.com' }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(d.name)}</title><meta name="description" content="${esc(d.tagline || 'Built with Pactsmith')}"><meta name="theme-color" content="${d.accent}">
<link rel="manifest" href="/app/${esc(id)}/manifest.webmanifest"><link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png">
<meta name="robots" content="noindex"><style>${CSS}</style></head><body class="${d.theme}" style="--accent:${d.accent}"><div id="app"></div>
<script id="spec" type="application/json">${data}</script><script>(${client.toString()})()</script></body></html>`;
}

export function manifest(b, id) {
  const d = b.dapp;
  return { name: d.name, short_name: d.name.slice(0, 12), description: d.tagline || 'Built with Pactsmith', start_url: `/app/${id}`, scope: `/app/${id}`, display: 'standalone', background_color: d.theme === 'dark' ? '#0d1020' : '#f6f7fb', theme_color: d.accent, icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] };
}

export const notFoundPage = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><body style="font:18px system-ui;padding:48px;max-width:560px;margin:auto"><h1>This app link has expired or does not exist</h1><p>Pactsmith keeps builds for 90 days. Ask the person who shared it to build it again.</p>';
