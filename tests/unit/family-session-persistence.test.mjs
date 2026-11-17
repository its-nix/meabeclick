import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setFamilySession,readFamilySession,FAMILY_COOKIE} from '../../src/lib/server/family-auth.ts';

/* Lior 2026-11-16: only a Google sign-in may create a persistent connection. A link
   from an email may be opened on a stranger's computer, so it must not remember. */
const jar=()=>{const sent=[];return{sent,set:(name,value,opts)=>sent.push({name,value,opts}),get:name=>sent.find(c=>c.name===name)?.value,delete(){}}};
const expiryMs=token=>Number(token.split('.')[3]);
const SIX_MONTHS=180*24*3600*1000,HALF_DAY=12*3600*1000;

test('a persistent (Google) session lasts six months in both the cookie and the signed token',()=>{
 const cookies=jar();setFamilySession(cookies,{kind:'account',id:7},{persistent:true});
 const c=cookies.sent[0];assert.equal(c.name,FAMILY_COOKIE);
 assert.equal(c.opts.maxAge,Math.floor(SIX_MONTHS/1000));
 assert.ok(Math.abs(expiryMs(c.value)-(Date.now()+SIX_MONTHS))<5000);
 assert.deepEqual(readFamilySession(cookies),{kind:'account',id:7});
});

test('a non-persistent (email link) session is a browser-session cookie with a short signed token',()=>{
 const cookies=jar();setFamilySession(cookies,{kind:'account',id:7},{persistent:false});
 const c=cookies.sent[0];
 assert.equal(c.opts.maxAge,undefined,'no maxAge, so the browser drops it on close');
 assert.equal(c.opts.expires,undefined);
 assert.ok(expiryMs(c.value)<=Date.now()+HALF_DAY+5000,'a copied cookie value must stop working within hours');
 assert.ok(expiryMs(c.value)>Date.now(),'still valid right now');
 assert.deepEqual(readFamilySession(cookies),{kind:'account',id:7});
 assert.equal(c.opts.httpOnly,true);assert.equal(c.opts.sameSite,'lax');
});

test('every caller must say whether the session persists',()=>{
 assert.throws(()=>setFamilySession(jar(),{kind:'account',id:1}),/persistent/);
});
