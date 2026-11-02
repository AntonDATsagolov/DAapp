// Общий клиент Supabase для всех трех PWA.
// В браузер разрешено помещать только publishable key.
// НИКОГДА не добавляйте сюда sb_secret_* или service_role ключи.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://huajxbmapmlprcyytsvu.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ZTIrnSQwmENwq0dFumJq1Q_HnbscpEm';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
