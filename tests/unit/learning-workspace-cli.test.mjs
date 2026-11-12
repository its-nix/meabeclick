import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const script=new URL('../../scripts/learning-workspace.mjs',import.meta.url);
test('connected CLI is explicit and refuses missing personal setup instead of business fallback',()=>{
 const env={...process.env,GOOGLE_OAUTH_CLIENT_ID:'business',GOOGLE_OAUTH_CLIENT_SECRET:'business-secret',GOOGLE_OAUTH_REFRESH_TOKEN:'business-refresh'};
 for(const key of Object.keys(env))if(key.startsWith('LEARNING_GOOGLE_'))delete env[key];
 const missing=spawnSync(process.execPath,[script.pathname,'--connected','status'],{env,encoding:'utf8'});
 assert.equal(missing.status,1);assert.match(missing.stderr,/setup/);assert.equal(missing.stdout,'');assert.ok(!missing.stderr.includes('business-secret'));
 for(const args of [['--connected','--config','file.json','status'],['status'],['--connected','--connected','status'],['--connected','context']]){
  const invalid=spawnSync(process.execPath,[script.pathname,...args],{env,encoding:'utf8'});assert.equal(invalid.status,1);assert.equal(invalid.stdout,'');
 }
});
