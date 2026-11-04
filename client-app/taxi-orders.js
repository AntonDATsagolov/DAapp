// DAapp passenger taxi orders: all writes/reads are guarded by Supabase RPC.
export const TAXI_STATUS_LABELS=Object.freeze({
  requested:'Ищем водителя',accepted:'Водитель принял заказ',
  completed:'Поездка завершена',cancelled:'Заказ отменён',
  expired:'Время ожидания истекло'
});
const validText=(value,max=160)=>{
  const s=String(value??'').trim();
  return s.length>=5 && s.length<=max ? s : null;
};
export function validateTaxiOrder(fields){
  const pickup=validText(fields.pickup);
  const destination=validText(fields.destination);
  const note=String(fields.note??'').trim();
  if(!pickup || !destination)
    return {error:'Укажите адрес подачи и пункт назначения (5–160 символов).'};
  if(note.length>240)return {error:'Комментарий слишком длинный (максимум 240 символов).'};
  return {payload:{p_pickup:pickup,p_destination:destination,p_note:note||null}};
}
function friendly(error){
  switch(String(error?.code??'')){
    case '42501':return 'Для заказа нужен подтверждённый аккаунт DAapp.';
    case '23505':return 'У вас уже есть активный заказ. Сначала завершите или отмените его.';
    case 'P0001':return 'Слишком частые заказы. Повторите чуть позже.';
    case 'PGRST202':case '42883':return 'Сервис такси ещё не подключён в Supabase (SQL 013).';
    default:return 'Не удалось выполнить действие. Проверьте сеть и повторите.';
  }
}
export async function createTaxiOrder(client,fields){
  const validation=validateTaxiOrder(fields);
  if(validation.error)return {error:validation.error};
  const {data,error}=await client.rpc('daapp_taxi_create_order',validation.payload);
  return error?{error:friendly(error)}:{id:data};
}
export async function fetchMyTaxiOrders(client){
  const {data,error}=await client.rpc('daapp_taxi_my_orders');
  if(error)throw error;
  return Array.isArray(data)?data:[];
}
export async function cancelTaxiOrder(client,id){
  const {data,error}=await client.rpc('daapp_taxi_cancel_order',{p_order_id:id});
  return error?{error:friendly(error)}:{success:data===true};
}
