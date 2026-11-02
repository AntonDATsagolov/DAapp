// DAapp Driver / Шиели: one-time registration and moderated line availability.
// Never modify profiles.role or expose driver details publicly.
export const VEHICLE_TYPES = Object.freeze({
  passenger: 'Легковой автомобиль',
  minivan: 'Минивэн',
  cargo: 'Грузовой автомобиль'
});
export const REVIEW_LABELS = Object.freeze({
  pending: 'На проверке',
  approved: 'Подтверждён',
  rejected: 'Отклонён'
});

export function validateDriver(data) {
  const full_name = String(data.full_name ?? '').trim();
  const contact_phone = String(data.contact_phone ?? '').trim();
  const vehicle_type = String(data.vehicle_type ?? '');
  const vehicle_model = String(data.vehicle_model ?? '').trim();
  const vehicle_plate = String(data.vehicle_plate ?? '').trim().toUpperCase();
  if (full_name.length < 2 || full_name.length > 80)
    return { error: 'Введите имя и фамилию (2–80 символов).' };
  if (contact_phone.length < 6 || contact_phone.length > 40)
    return { error: 'Укажите действующий телефон (6–40 символов).' };
  if (!Object.hasOwn(VEHICLE_TYPES, vehicle_type))
    return { error: 'Выберите тип автомобиля.' };
  if (vehicle_model.length < 2 || vehicle_model.length > 80)
    return { error: 'Укажите марку и модель автомобиля.' };
  if (vehicle_plate.length < 3 || vehicle_plate.length > 24)
    return { error: 'Укажите государственный номер автомобиля.' };
  // The server sets user_id, review_status and is_online; never send them.
  return { payload: { full_name, contact_phone, vehicle_type, vehicle_model, vehicle_plate } };
}

export async function fetchDriverRegistration(supabase) {
  const {data,error} = await supabase.from('driver_registrations')
    .select('user_id,full_name,contact_phone,vehicle_type,vehicle_model,vehicle_plate,review_status,is_online,created_at')
    .maybeSingle(); // RLS ensures at most one record for the current user.
  if (error) throw error;
  return data;
}

export async function submitDriverRegistration(supabase, values) {
  const {payload,error: validationError} = validateDriver(values);
  if (validationError) return {error: validationError};
  const {error} = await supabase.from('driver_registrations').insert(payload);
  if (error) return {error: publicDriverError(error)};
  return {success: true};
}

export async function setDriverAvailability(supabase, online) {
  if (typeof online !== 'boolean') return {error: 'Неверное состояние линии.'};
  const {data,error} = await supabase.rpc('daapp_driver_set_online', {p_online: online});
  if (error) return {error: publicDriverError(error)};
  return {success: true, is_online: data === true};
}

export function publicDriverError(error) {
  const code = String(error?.code || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0,32);
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883')
    return 'Для сохранения анкеты нужно настроить SQL 007 в Supabase.';
  if (code === '23505') return 'Анкета уже существует. Обновите страницу.';
  if (code === '42501') return 'Недостаточно прав: выход на линию разрешён только после проверки водителя.';
  if (code === '23514' || code === '22023') return 'Проверьте введённые данные.';
  return 'Не удалось выполнить действие (код: ' + (code || 'network') + '). Повторите позже.';
}
