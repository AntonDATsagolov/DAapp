// DAapp driver dispatch: no direct access to passenger/driver tables.
export const DRIVER_ORDER_STATUS=Object.freeze({
  requested:'Новый заказ',accepted:'Ваш принятый заказ',
  cancelled:'Пассажир отменил заказ'
});
export async function fetchDriverTaxiOrders(client){
  const {data,error}=await client.rpc('daapp_taxi_driver_orders');
  if(error)throw error;
  return Array.isArray(data)?data:[];
}
export async function acceptDriverTaxiOrder(client,id){
  const {data,error}=await client.rpc('daapp_taxi_accept_order',{p_order_id:id});
  if(error)return {error:driverTaxiError(error)};
  return data===true?{success:true}:{error:'Не удалось подтвердить принятие заказа.'};
}
export async function completeDriverTaxiOrder(client,id){
  const {data,error}=await client.rpc('daapp_taxi_complete_order',{p_order_id:id});
  if(error)return {error:driverTaxiError(error)};
  return data===true?{success:true}:{error:'Не удалось подтвердить завершение поездки.'};
}
export function driverTaxiError(error){
  const code=String(error?.code||'');
  if(['PGRST202','42883'].includes(code))
    return 'Для работы с заказами необходимо установить SQL 013 в Supabase.';
  if(code==='P0002'||code==='23505')
    return 'Этот заказ уже принят другим водителем или недоступен. Обновите список.';
  if(code==='42501')
    return 'Заказы доступны только подтверждённому водителю на линии.';
  if(code==='P0001')
    return 'Сначала завершите уже принятую поездку.';
  return 'Не удалось обработать заказ. Проверьте сеть и повторите.';
}
