// Local-only host integration fixture. No production accounts or services are used.
import http from 'node:http';

const appOrigin = 'http://127.0.0.1:4196';
const accountOrigin = 'http://127.0.0.1:4197';
let untrustedRequests = 0;
const untrustedDetails = [];
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { color-scheme: light dark; font: 15px 'Segoe UI',sans-serif; background:#f2f7fc;color:#203342 }
body{margin:0;padding:32px} h1{font-size:28px} button{border:1px solid #dbe5ed;border-radius:24px;padding:12px 20px;background:#fff;color:#203342;cursor:pointer}
button.primary{background:#ff6b0b;color:#1c2d3a;border:0} section{background:#fff;border:1px solid #dbe5ed;border-radius:24px;padding:24px;margin:24px 0}p{line-height:1.6} textarea{width:90%;min-height:70px;border-radius:16px;padding:12px;border:1px solid #dbe5ed}
@media(prefers-color-scheme:dark){:root{background:#1c2d3a;color:#f2f7fc}section,button{background:#203342;color:#f2f7fc;border-color:#40515d}}
</style></head><body><h1 id="route">Connect</h1><p>Connect. Talk. Celebrate.</p>
<section><h2>Solar, together.</h2><p>Local integration fixture for the native Windows workspace.</p><button class="primary" id="sunhub">Continue with Sunhub</button> <a id="internal" href="/directory" target="_blank">Discover companies</a> <a id="external" href="http://127.0.0.1:4198/trusted-external">Company website</a></section>
<section><h2>Company updates</h2><p>Project progress. Company news. Work worth celebrating.</p><textarea placeholder="What’s happening at your company?"></textarea></section>
<div id="command" aria-live="polite"></div>
<script>
window.fixtureState={type:'state',ready:true,path:location.pathname,signedIn:false,accountType:'',userName:'',companyName:'',canPublish:false,unreadCount:0};
window.commands=[];window.authDone=false;window.fixtureBoot=crypto.randomUUID();
window.sendState=()=>{fixtureState.path=location.pathname;document.getElementById('route').textContent=location.pathname==='/'?'Home':location.pathname.slice(1);window.chrome?.webview?.postMessage(fixtureState)};
addEventListener('connect:windows-command',e=>{commands.push(e.detail);if(e.detail.type==='navigate'){history.pushState({},'',e.detail.path);sendState()}document.getElementById('command').textContent=e.detail.type;if(e.detail.type==='state')sendState()});
addEventListener('popstate',sendState);
document.getElementById('sunhub').onclick=()=>{window.lastPopup=window.open('${appOrigin}/api/auth/sunhub/start','sunhub-signin','width=500,height=720')};
addEventListener('message',e=>{if(e.origin==='${appOrigin}'&&e.data?.type==='fixture-auth-complete'){window.authDone=true}});
sendState();
</script></body></html>`;

const start = (port, handler) => http.createServer(handler).listen(port, '127.0.0.1', () => console.log(`Fixture listening on ${port}`));
const html = (res, text) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text); };
start(4196, (req, res) => {
  const url = new URL(req.url, appOrigin);
  if (url.pathname === '/api/auth/sunhub/start') { res.writeHead(302, { Location: `${accountOrigin}/login` }); return res.end(); }
  if (url.pathname === '/auth/sunhub/popup') {
    res.setHeader('Set-Cookie', 'fixtureAuth=complete; Path=/; SameSite=Lax; Max-Age=3600');
    return html(res, `<script>window.opener?.postMessage({type:'fixture-auth-complete'},'${appOrigin}');window.close();</script>`);
  }
  if (url.pathname === '/stats') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ untrustedRequests, untrustedDetails })); }
  html(res, page);
});
start(4197, (_req, res) => html(res, `<!doctype html><html><body style="font:16px 'Segoe UI';padding:32px"><h1>Continue with Sunhub</h1><p>Local test account</p><button id="continue" style="padding:12px 24px" onclick="location.href='${appOrigin}/auth/sunhub/popup'">Continue</button></body></html>`));
start(4198, (req, res) => { untrustedRequests++; untrustedDetails.push({url:req.url,userAgent:req.headers['user-agent'],fetchMode:req.headers['sec-fetch-mode'],fetchDestination:req.headers['sec-fetch-dest']}); html(res, '<h1>Untrusted origin must not load inside Connect</h1>'); });
