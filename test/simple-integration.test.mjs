import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevLiteHostingIntegration} from '../index.js';
import {mountDevLite} from '../embed.js';

test('enable installs secrets, returns safe metadata, and retries configuration failures',async()=>{
  let attempts=0,fail=true;
  const input={customerId:'customer',externalResourceId:'app',name:'API'};
  const resource={id:'r',projectId:'p',...input,service:'api',environment:'production',status:'active',createdAt:'now',created:false,environmentVariables:{DEVLITE_API_KEY:'secret',DEVLITE_ENDPOINT:'https://api.test/v1/events'}};
  const integration=createDevLiteHostingIntegration({
    client:{provision:async(app)=>{assert.equal(app.customerId,'customer');return resource;},createLaunch:async()=>({code:'code',expiresAt:'soon'})},
    allowedOrigins:['https://console.test'],authorize:async()=>({resourceId:'r',actorId:'user'}),
    applyEnvironment:async(data)=>{attempts++;assert.equal(data.environmentVariables.DEVLITE_API_KEY,'secret');assert.equal(data.resource.id,'r');if(fail)throw Error('platform unavailable');},
  });
  await assert.rejects(()=>integration.enable(input),/platform unavailable/);
  fail=false;
  const result=await integration.enable(input);
  assert.equal(attempts,2);
  assert.equal(result.id,'r');
  assert(!JSON.stringify(result).includes('secret'));
  assert(!('environmentVariables' in result));
});

test('simple launch route still validates origin and current platform authorization',async()=>{
  let checks=0,launches=0;
  const integration=createDevLiteHostingIntegration({
    client:{provision:async()=>{},createLaunch:async(id,grant)=>{launches++;assert.equal(id,'resource');assert.deepEqual(grant.permissions,['read']);return {code:'one-time',expiresAt:'soon',environmentVariables:{secret:'never-return'}};}},
    allowedOrigins:['https://console.test'],authorize:async()=>{checks++;return {resourceId:'resource',actorId:'current-user'};},applyEnvironment:async()=>{},
  });
  const request=origin=>new Request('https://console.test/api/launch',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({nonce:'a'.repeat(32),parentOrigin:origin})});
  assert.equal((await integration.launchRoute(request('https://evil.test'))).status,403);
  assert.equal(checks,0);
  const response=await integration.launchRoute(request('https://console.test'));
  assert.deepEqual(await response.json(),{code:'one-time',expiresAt:'soon'});
  assert.equal(checks,1);assert.equal(launches,1);
});

test('launchUrl removes browser plumbing without permitting cross-origin credential forwarding',async()=>{
  const previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
  let listener,uploaded,posted;
  const frame={style:{},setAttribute(){},remove(){},contentWindow:{postMessage(data){posted=data;}}};
  globalThis.window={location:{origin:'https://console.test'},addEventListener(_,fn){listener=fn;},removeEventListener(){}};
  globalThis.document={createElement:()=>frame};
  globalThis.fetch=async(url,options)=>{uploaded={url:String(url),...options};return {ok:true,json:async()=>({code:'c'.repeat(43)})};};
  const base={container:{appendChild(){}},providerId:'11111111-1111-4111-8111-111111111111',dashboardUrl:'https://devlite.test'};
  try{
    assert.throws(()=>mountDevLite({...base,launchUrl:'https://evil.test/launch'}),/own origin/);
    assert.throws(()=>mountDevLite({...base,launchUrl:'/launch',createLaunch:async()=>({code:'x'})}),/not both/);
    const embed=mountDevLite({...base,launchUrl:'/api/apps/1/launch'});
    listener({source:frame.contentWindow,origin:'https://devlite.test',data:{type:'devlite:ready',providerId:base.providerId,nonce:'n'.repeat(32)}});
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(uploaded.url,'https://console.test/api/apps/1/launch');
    assert.equal(uploaded.credentials,'same-origin');assert.equal(uploaded.redirect,'error');
    assert.deepEqual(JSON.parse(uploaded.body),{nonce:'n'.repeat(32),parentOrigin:'https://console.test'});
    assert.equal(posted.code,'c'.repeat(43));
    embed.destroy();assert.equal(uploaded.signal.aborted,true);
  }finally{Object.assign(globalThis,previous);}
});
