// Single DAapp identity for residents, drivers and business users.
// Passwords go ONLY to Supabase Auth; never into our public tables.
export const USERNAME_PATTERN = /^[a-z][a-z0-9_]{3,23}$/;

export function normalizePhone(input) {
  const s = String(input || '').replace(/[\s()\-]/g, '');
  const p = /^8\d{10}$/.test(s) ? '+7' + s.slice(1) : s;
  return /^\+7\d{10}$/.test(p) ? p : null;
}

export function validateSignup(form) {
  const username = String(form.username || '').trim().toLowerCase();
  const phone = normalizePhone(form.phone);
  const age = Number(form.age);
  const password = String(form.password || '');
  if (!USERNAME_PATTERN.test(username))
    return {error: 'Логин: 4–24 символа, латинские буквы, цифры и _. Начните с буквы.'};
  if (!phone)
    return {error: 'Укажите действующий номер Казахстана, например +7 777 123 45 67.'};
  if (!Number.isInteger(age) || age < 13 || age > 120)
    return {error: 'Проверьте возраст. Самостоятельная регистрация сейчас доступна с 13 лет.'};
  if (password.length < 10 || password.length > 72)
    return {error: 'Пароль должен содержать 10–72 символа.'};
  return {username, phone, age, password};
}

export async function registerWithPhone(client, values) {
  const data = validateSignup(values);
  if (data.error) return {error:data.error};
  const {error} = await client.auth.signUp({
    phone:data.phone,
    password:data.password,
    options:{channel:'sms'}
  });
  if (error) return {error:'Не удалось отправить SMS. Проверьте настройки SMS, лимит и номер.'};
  return {phone:data.phone,username:data.username,age:data.age};
}

export async function verifyPhoneAndClaim(client, pending, otp) {
  if (!pending?.phone) return {error:'Сначала заполните регистрацию.'};
  const code=String(otp || '').trim();
  if (!/^\d{4,8}$/.test(code)) return {error:'Укажите код из SMS.'};
  const {error} = await client.auth.verifyOtp({
    phone:pending.phone, token:code, type:'sms'
  });
  if (error) return {error:'Код неверен или истёк. Проверьте SMS.'};
  return claimUsername(client,pending.username,pending.age);
}

export async function claimUsername(client, username, age) {
  const {data,error} = await client.rpc('daapp_claim_username',{
    p_username:String(username || '').trim().toLowerCase(),
    p_age:Number(age)
  });
  if (error) return {error:error.code === '23505'
    ? 'Этот логин уже занят или закреплён за другим аккаунтом.'
    : error.code === '42501'
      ? 'Сначала подтвердите номер телефона по SMS.'
      : 'Не удалось закрепить логин. Проверьте SQL 008. Код '+String(error.code || 'network').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,24)};
  return {username:data};
}

export async function signInAccount(client, identifier, password, config) {
  const login=String(identifier || '').trim().toLowerCase();
  const pass=String(password || '');
  if (!login || !pass) return {error:'Введите логин и пароль.'};
  const phone=normalizePhone(login);
  if (phone) {
    const {error} = await client.auth.signInWithPassword({phone,password:pass});
    return error ? {error:'Неверные данные или номер ещё не подтверждён.'} : {success:true};
  }
  if (!USERNAME_PATTERN.test(login))
    return {error:'Укажите логин латиницей или номер +7.'};
  // Username resolution is privileged and never happens in the browser.
  // Deploy the Edge Function explicitly; never expose service_role here.
  const endpoint=config?.usernameEndpoint;
  if (!endpoint) return {error:'Вход по логину пока не подключён. Используйте номер телефона.'};
  let response;
  try {
    response=await fetch(endpoint,{
      method:'POST',cache:'no-store',credentials:'omit',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({username:login,password:pass})
    });
  } catch {
    return {error:'Сервер входа по логину недоступен. Можно войти по номеру.'};
  }
  if (!response.ok) return {error:response.status===404 || response.status===503
    ? 'Вход по логину ещё не активирован. Используйте номер телефона.'
    : 'Неверный логин или пароль. Проверьте данные.'};
  const data=await response.json().catch(()=>null);
  if (!data?.access_token || !data?.refresh_token)
    return {error:'Сервер входа вернул неполные данные.'};
  const {error}=await client.auth.setSession({
    access_token:data.access_token, refresh_token:data.refresh_token
  });
  return error ? {error:'Не удалось завершить вход.'} : {success:true};
}

export const NEXT_DESTINATIONS=Object.freeze({
  resident:'../client-app/',
  business:'../business-app/',
  driver:'../driver-app/'
});
export function safeDestination(value) {
  return NEXT_DESTINATIONS[String(value||'')] ? String(value) : 'resident';
}
