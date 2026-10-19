const { test }=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {GoogleOAuth}=require('../sync/oauth');
function memoryVault() {
  let value;
  return {get:async()=>value,set:async(v)=>{value=v;},clear:async()=>{value=null;}};
}
test('authorization validates state and exchanges PKCE code through loopback',async()=> {
  const vault=memoryVault();
  let exchange;
  const oauth=new GoogleOAuth({clientId:'test.apps.googleusercontent.com',vault,fetchImpl:async(url,options)=>{
    exchange=options.body;
    return Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600});
  }});
  const flow=await oauth.begin();
  const url=new URL(flow.url),redirect=url.searchParams.get('redirect_uri');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal((await fetch(`${redirect}?state=wrong&code=code`)).status,400);
  await fetch(`${redirect}?state=${url.searchParams.get('state')}&code=code`);
  assert.deepEqual(await flow.result,{connected:true});
  assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'),url.searchParams.get('code_challenge'));
  assert.equal(await oauth.getToken(),'access');
  await oauth.disconnect(); assert.equal(await vault.get(),null);
});
test('cancelled authorization closes listener without saving credentials',async()=> {
  const vault=memoryVault(),oauth=new GoogleOAuth({clientId:'test',vault});
  const flow=await oauth.begin();
  flow.cancel(); await assert.rejects(flow.result,/cancelled/);
  assert.equal(await vault.get(),undefined);
});
test('token refresh retains refresh token and disconnect clears it',async()=> {
  const vault=memoryVault();await vault.set({access_token:'old',refresh_token:'keep',expiresAt:0,accountId:'same-user'});
  const oauth=new GoogleOAuth({clientId:'test',vault,fetchImpl:async()=>Response.json({access_token:'new',expires_in:3600})});
  assert.equal(await oauth.getToken(),'new'); assert.equal((await vault.get()).refresh_token,'keep');assert.equal((await vault.get()).accountId,'same-user');
  await oauth.disconnect();await assert.rejects(oauth.getToken(),/not connected/);
});
test('disconnect during refresh prevents credentials being restored',async()=> {
  const vault=memoryVault();await vault.set({refresh_token:'keep',expiresAt:0});
  let complete,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const oauth=new GoogleOAuth({clientId:'test',vault,fetchImpl:async()=>{started();return new Promise(resolve=>{complete=resolve;});}});
  const token=oauth.getToken(); token.catch(()=>{}); await ready;
  await oauth.disconnect();complete(Response.json({access_token:'late',expires_in:3600}));
  await assert.rejects(token,/disconnected/);assert.equal(await vault.get(),null);
});
