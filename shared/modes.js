// DAapp mode preferences are NOT privileges: a server RPC resolves actual
// reviewed driver and approved-business access for the signed-in user.
export const MODE_PATHS=Object.freeze({
  resident:'../client-app/',
  business:'../business-app/',
  driver:'../driver-app/'
});
export const MODE_LABELS=Object.freeze({
  resident:'Житель / покупатель',
  business:'Предприниматель',
  driver:'Водитель / таксист'
});
export const MODE_NAMES=Object.freeze(['resident','business','driver']);

export function normalizeModeState(raw){
  const approved=raw?.approved===true;
  const allowed=approved && Array.isArray(raw?.available_modes)
    ? MODE_NAMES.filter(m=>raw.available_modes.includes(m))
    : [];
  if(approved && !allowed.includes('resident'))allowed.unshift('resident');
  const last=allowed.includes(raw?.last_mode)?raw.last_mode:'resident';
  return {
    approved,
    accountStatus:String(raw?.account_status||'pending'),
    availableModes:allowed,
    lastMode:last,
    driverApplication:String(raw?.driver_application||'none'),
    businessApplication:String(raw?.business_application||'none')
  };
}
export async function getModeState(client){
  const {data,error}=await client.rpc('daapp_mode_status');
  if(error)return {error:'Режимы недоступны. Проверьте SQL 011 и подключение Supabase.'};
  return {state:normalizeModeState(data)};
}
export async function saveLastMode(client,mode){
  if(!Object.hasOwn(MODE_PATHS,mode))
    return {error:'Неизвестный режим DAapp.'};
  const {data,error}=await client.rpc('daapp_set_last_mode',{p_mode:mode});
  if(error || data!==mode)
    return {error:'Этот режим ещё не подтверждён или доступ был отозван. Обновите список режимов.'};
  return {saved:mode};
}
export function modeUrl(mode,baseHref){
  const safe=Object.hasOwn(MODE_PATHS,mode)?mode:'resident';
  return new URL(MODE_PATHS[safe],baseHref).href;
}
