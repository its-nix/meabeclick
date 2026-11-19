// Containment/deadline fixture only. NOT normal-app authentication evidence.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function fakeAuthTransport() {
  const dir = await mkdtemp(join(tmpdir(), 'at-'));
  await writeFile(join(dir, 'docker'), `#!${process.execPath}
const { randomBytes } = require('node:crypto');
const { createInterface } = require('node:readline');
console.log(JSON.stringify({token: randomBytes(32).toString('base64url')}));
createInterface({input:process.stdin}).on('line', phase => console.log(JSON.stringify({verified:phase})));
`, { mode: 0o755 });
  return { docker: join(dir, 'docker'), env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, close: () => rm(dir, { recursive: true, force: true }) };
}
export function respondAuthFixture(req, res) {
  if (req.url === '/api/family') {
    res.writeHead(200, {'content-type':'application/json', 'cache-control':'no-store'}).end(JSON.stringify({
      signedIn:true,kind:'student',isSelf:false,canSeeParentView:false,accountName:'הורה בדיקה אלפא',
      defaultStudent:'synthetic-student-gamma',students:[{code:'synthetic-student-gamma',name:'תלמידת בדיקה גמא',emoji:'🧪'}],
    })); return true;
  }
  if (['/api/portal/synthetic-student-gamma?kind=parent', '/api/portal/synthetic-sibling-sentinel',
    '/api/payments?student=synthetic-student-gamma'].includes(req.url)) {
    res.writeHead(401).end(); return true;
  }
  if (req.url === '/enter') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('כניסה לדף האישי');
    return true;
  }
  if (req.url === '/api/access/redeem') {
    req.resume();
    const replay = Boolean(req.socket.server.syntheticRedeemed);
    req.socket.server.syntheticRedeemed = true;
    res.writeHead(replay ? 401 : 200, {
      'cache-control': 'no-store', 'content-type': 'application/json',
      ...(replay ? {} : { 'set-cookie': 'maab_family=u.s.92001.fixture; Path=/; HttpOnly; SameSite=Lax' }),
    }).end(JSON.stringify(replay ? {error:'הקישור כבר לא תקף. אפשר לבקש קישור אישי חדש — בלי לחכות למורה.'}
      : {ok:true,destination:'/app/student?s=synthetic-student-gamma'}));
    return true;
  }
  return false;
}
