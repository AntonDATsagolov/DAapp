// DAapp email+password registration with manual administrator approval.
// Phone is CONTACT ONLY: no SMS confirmation and no Supabase Phone Auth.
// New users must confirm email and be approved before protected data access.
export const USERNAME=/^[a-z][a-z0-9_]{3,23}$/;
export const MAX_AVATAR_BYTES=1572864;
const IMAGE_TYPES=Object.freeze({'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'});

export function formatKzPhone(raw) {
  const s=String(raw||'').replace(/[\\s()\\-]/g,'');
  const p=/^8[0-9]{10}$/.test(s)?'+7'+s.slice(1):s;
  return /^[+]7[0-9]{10}$/.test(p)?p:null;
}

export function validateEmailRegistration(values) {
  const username=String(values.username||'').trim().toLowerCase();
  const email=String(values.email||'').trim().toLowerCase();
  const phone=formatKzPhone(values.phone);
  const age=Number(values.age);
  const password=String(values.password||'');
  const residency=values.residency;
  if(!USERNAME.test(username))return {error:'Логин: 4–24 латинских символа, цифры или _. Первая — буква.'};
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length>254)
    return {error:'Введите правильный адрес электронной почты.'};
  if(!phone)return {error:'Укажите номер Казахстана в формате +7 777 123 45 67.'};
  if(!Number.isInteger(age) || age<13 || age>120)
    return {error:'Возраст должен быть от 13 до 120 лет.'};
  if(!['resident','guest'].includes(residency))
    return {error:'Выберите: житель или гость Шиели.'};
  if(password.length<10 || password.length>72)
    return {error:'Пароль должен содержать от 10 до 72 символов.'};
  if(password!==values.confirmPassword)
    return {error:'Пароли не совпадают.'};
  const publishPhone=age>=18 && values.publishPhone===true;
  return {username,email,phone,age,password,residency,publishPhone};
}

export async function submitEmailRegistration(client,values,redirectUrl) {
  const data=validateEmailRegistration(values);
  if(data.error)return {error:data.error};
  const {error, data:created}=await client.auth.signUp({
    email:data.email,password:data.password,
    options:{
      emailRedirectTo:redirectUrl,
      data:{daapp_registration:{
        flow:'email_manual_v1',
        username:data.username,
        phone:data.phone,
        age:data.age,
        residency:data.residency,
        publish_phone:data.publishPhone
      }}
    }
  });
  if(error)return {error:'Регистрация не завершилась. Возможно, логин занят, e-mail зарегистрирован или почтовый сервис недоступен. Код: '+
    String(error.code||'signup').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40)};
  return {registered:true,hasSession:Boolean(created?.session)};
}

export async function accountDecision(client) {
  const {data,error}=await client.from('daapp_account_applications')
    .select('status,phone_number,residency,public_phone,avatar_path')
    .maybeSingle();
  if(error)return {error:'Не установлена SQL 009 или нет доступа к заявке.'};
  return data || {status:'approved',legacy:true}; // pre-migration users only
}

export async function uploadAvatar(client,userId,file) {
  if(!file || !Object.hasOwn(IMAGE_TYPES,file.type))
    return {error:'Выберите JPG, PNG или WebP.'};
  if(file.size<1 || file.size>MAX_AVATAR_BYTES)
    return {error:'Фотография должна быть не больше 1,5 МБ.'};
  if(!/^[0-9a-f-]{36}$/i.test(String(userId||'')))
    return {error:'Не удалось определить владельца фотографии.'};
  const path=userId+'/'+crypto.randomUUID()+IMAGE_TYPES[file.type];
  const {error:uploaded}=await client.storage.from('daapp-avatars')
    .upload(path,file,{contentType:file.type,upsert:false});
  if(uploaded)return {error:'Не удалось загрузить фотографию. Проверьте SQL 009 и подтверждение e-mail.'};
  const {error:saved}=await client.rpc('daapp_set_avatar_path',{p_path:path});
  if(saved)return {error:'Фото загружено, но не прикреплено к профилю. Обновите страницу и повторите.'};
  return {path};
}

export function avatarPublicUrl(client,path) {
  if(!path || !/^[0-9a-f-]{36}\\/[0-9a-f-]{36}\\.(jpg|png|webp)$/i.test(path))
    return null;
  const {data}=client.storage.from('daapp-avatars').getPublicUrl(path);
  return data?.publicUrl||null;
}

export async function updatePublicPhoneConsent(client,show) {
  const {error}=await client.rpc('daapp_set_phone_visibility',{p_public:show===true});
  return error?{error:'Не удалось изменить видимость телефона. Публичный номер доступен только одобренным взрослым аккаунтам.'}:{success:true};
}
