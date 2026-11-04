// DAapp business hours are manually reported by the verified applicant.
// Never write map_places directly from a browser or infer ownership from names.
export async function fetchMyWorkplaces(client){
  const {data,error}=await client.rpc('daapp_business_my_workplaces');
  if(error)throw error;
  return Array.isArray(data)?data:[];
}
export async function setBusinessWorking(client,placeId,working){
  if(typeof working!=='boolean' || typeof placeId!=='string' ||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(placeId)){
    return {error:'Неверная организация или статус работы.'};
  }
  const {data,error}=await client.rpc('daapp_business_set_working',{
    p_place_id:placeId,p_working:working
  });
  if(error) {
    return {error:error.code==='42501'
      ?'Управлять статусом может только подтверждённый владелец этой организации.'
      :'Не удалось сохранить статус работы. Проверьте подключение и SQL 012.'};
  }
  return data===working?{success:true,is_working:working}
    :{error:'Не удалось подтвердить сохранённый статус.'};
}
