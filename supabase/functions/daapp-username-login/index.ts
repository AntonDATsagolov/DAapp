// Supabase Edge Function: daapp-username-login
// Run ONLY on Supabase servers with server-side service role secret.
// Deploy with JWT verification OFF because callers are not signed in yet.
// Never publish a copy of SUPABASE_SERVICE_ROLE_KEY in client code.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?bundle';

const url=Deno.env.get('SUPABASE_URL') || '';
const adminKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const anonKey=Deno.env.get('SUPABASE_ANON_KEY') || '';
const allowedOrigins=new Set([
  'https://antondatsagolov.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
]);

function cors(origin) {
  return {
    'access-control-allow-origin':origin,
    'access-control-allow-methods':'POST, OPTIONS',
    'access-control-allow-headers':'content-type, apikey, authorization, x-client-info',
    'cache-control':'no-store, max-age=0',
    'vary':'Origin'
  };
}
function json(status, body, origin){
  return new Response(JSON.stringify(body),{
    status,headers:{...cors(origin),'content-type':'application/json; charset=utf-8'}
  });
}

Deno.serve(async(request)=>{
  const origin=request.headers.get('origin') || '';
  if(!allowedOrigins.has(origin))
    return new Response(null,{status:403});
  if(request.method==='OPTIONS')
    return new Response(null,{status:204,headers:cors(origin)});
  if(request.method!=='POST')
    return json(405,{error:'Method not allowed'},origin);
  if(!url||!adminKey||!anonKey)
    return json(503,{error:'Service is not configured'},origin);
  const size=Number(request.headers.get('content-length')||0);
  if(size>2048) return json(413,{error:'Payload too large'},origin);

  let body;
  try { body=await request.json(); }
  catch { return json(400,{error:'Invalid request'},origin); }
  const username=String(body?.username||'').trim().toLowerCase();
  const password=String(body?.password||'');
  if(!/^[a-z][a-z0-9_]{3,23}$/.test(username) || !password || password.length>256)
    return json(401,{error:'Invalid credentials'},origin);
  try {
    const privileged=createClient(url,adminKey,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{'x-daapp-username-auth':'v1'}}
    });
    const {data:identity,error:lookupError}=await privileged
      .from('daapp_member_accounts')
      .select('user_id').eq('username',username).maybeSingle();
    if(lookupError || !identity?.user_id)
      return json(401,{error:'Invalid credentials'},origin);

    const {data:target,error:accountError}=await privileged.auth.admin
      .getUserById(identity.user_id);
    if(accountError || !target?.user?.phone ||
       !target.user.phone_confirmed_at)
      return json(401,{error:'Invalid credentials'},origin);

    // Password is verified by Supabase Auth, NEVER in our Edge Function.
    const publicClient=createClient(url,anonKey,{
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const {data:login,error:authError}=await publicClient.auth.signInWithPassword({
      phone:target.user.phone, password
    });
    if(authError || !login?.session?.access_token || !login?.session?.refresh_token ||
       login.user?.id!==identity.user_id)
      return json(401,{error:'Invalid credentials'},origin);
    return json(200,{
      access_token:login.session.access_token,
      refresh_token:login.session.refresh_token
    },origin);
  } catch {
    return json(503,{error:'Authentication temporarily unavailable'},origin);
  }
});
