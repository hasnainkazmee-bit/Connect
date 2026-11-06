// Local-only HTTP fixture. No production accounts, email, tokens, or data are used.
import http from "node:http";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";

const output = process.argv[2];
if (!output) throw new Error("Pass the fixture discovery file path.");
const nonce = randomBytes(24).toString("hex");
let connectOrigin, ssoOrigin, recovered = false;
const html = (response, body, headers = {}) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(body);
};
const main = () => `<!doctype html><meta charset="utf-8"><title>Connect WebKit fixture</title>
<h1 id="page">Connect fixture</h1><textarea id="draft" aria-label="Draft"></textarea><a id="next" href="/next">Next page</a>
<script>
window.smoke = { received: false, session: false, closed: false, callbackOrigin: '', providerVisited: false };
window.startAuth = mode => {
  window.smoke.received = false; window.smoke.session = false;
  window.authPopup = window.open('/api/auth/sunhub/start?mode=' + mode, 'connect-smoke-${nonce}', 'popup=yes,width=500,height=680');
  return !!window.authPopup;
};
window.addEventListener('message', async event => {
  if (event.origin !== location.origin || event.source !== window.authPopup || event.data?.nonce !== '${nonce}' || event.data?.type !== 'connect:sunhub:complete') return;
  window.smoke.received = true; window.smoke.callbackOrigin = event.origin;
  const session = await (await fetch('/api/session')).json();
  window.smoke.session = session.signedIn === true;
  event.source.postMessage({type:'connect:sunhub:ready',nonce:'${nonce}',status:session.signedIn?'success':'error'}, location.origin);
});
</script>`;
const connect = http.createServer((request, response) => {
  const url = new URL(request.url, connectOrigin || "http://127.0.0.1");
  if (url.pathname === "/") return html(response, main());
  if (url.pathname === "/next") return html(response, '<!doctype html><h1 id="page">Next page</h1>');
  if (url.pathname === "/api/session") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return response.end(JSON.stringify({ signedIn: (request.headers.cookie || "").split(/;\s*/).includes(`connect_mac_smoke=${nonce}`) }));
  }
  if (url.pathname === "/api/auth/sunhub/start") {
    response.writeHead(303, { Location: `${ssoOrigin}/login?mode=${url.searchParams.get("mode") || "success"}`, "Cache-Control": "no-store" });
    return response.end();
  }
  if (url.pathname === "/api/auth/sunhub/callback") {
    return html(response, `<!doctype html><h1>Returning to Connect</h1><script>
      window.callbackHasOpener = !!window.opener;
      window.addEventListener('message', event => {
        if(event.origin !== '${connectOrigin}' || event.source !== window.opener || event.data?.type !== 'connect:sunhub:ready' || event.data?.nonce !== '${nonce}') return;
        window.readyStatus = event.data.status;
        if(event.data.status === 'success') setTimeout(() => window.close(), 150);
      });
      window.opener?.postMessage({type:'connect:sunhub:complete', nonce:'${nonce}', status:'success'}, '${connectOrigin}');
    </script>`, { "Set-Cookie": `connect_mac_smoke=${nonce}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600` });
  }
  if (url.pathname === "/network-failure") {
    if (!recovered) return request.socket.destroy();
    return html(response, '<!doctype html><h1 id="page">Connection restored</h1>');
  }
  if (url.pathname === "/control/recover") {
    recovered = true; response.writeHead(204); return response.end();
  }
  response.writeHead(404); response.end();
});
const sso = http.createServer((request, response) => {
  const url = new URL(request.url, ssoOrigin || "http://localhost");
  if (url.pathname !== "/login") { response.writeHead(404); return response.end(); }
  html(response, `<!doctype html><title>Sunhub fixture</title><h1 id="provider">Sunhub account fixture</h1>
  <button id="continue" onclick="location.href='${connectOrigin}/api/auth/sunhub/callback'">Continue</button>`);
});
await new Promise(resolve => connect.listen(0, "127.0.0.1", resolve));
// localhost uses a separate cookie host while :: accepts IPv4 and IPv6 on macOS.
await new Promise(resolve => sso.listen(0, "::", resolve));
connectOrigin = `http://127.0.0.1:${connect.address().port}`;
ssoOrigin = `http://localhost:${sso.address().port}`;
await fs.writeFile(output, JSON.stringify({ connectOrigin, ssoOrigin }));
const stop = () => { connect.close(); sso.close(); process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
