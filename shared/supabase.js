// Общий клиент Supabase для всех трех PWA.
// В браузер разрешено помещать только publishable key.
// НИКОГДА не добавляйте сюда sb_secret_* или service_role ключи.
// Если один CDN недоступен, пробуем второй. Это важно в слабой сети.
let createClient;
for (const source of [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  'https://esm.sh/@supabase/supabase-js@2?bundle'
]) {
  try {
    ({ createClient } = await import(source));
    if (typeof createClient === 'function') break;
  } catch (error) {
    console.warn('Не удалось загрузить Supabase JS с источника:', source, error);
  }
}
if (typeof createClient !== 'function') {
  throw new Error('Не удалось загрузить библиотеку Supabase с двух CDN. Проверьте доступ к CDN.');
}

export const SUPABASE_URL = 'https://huajxbmapmlprcyytsvu.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ZTIrnSQwmENwq0dFumJq1Q_HnbscpEm';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
