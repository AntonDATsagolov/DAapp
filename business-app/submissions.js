// DAapp: заявки на организации Шиели. Требуют входа, но не повышенной роли.
// Browser is never allowed to choose applicant_id, moderation status or publication.
export const CATEGORIES = Object.freeze({
  shop: 'Магазин', cafe: 'Кафе', beauty: 'Салон красоты',
  hotel: 'Гостиница', taxi: 'Такси / перевозки'
});
export const STATUS_LABELS = Object.freeze({
  pending: 'На проверке', approved: 'Проверена администратором',
  rejected: 'Отклонена'
});

export function parseOptionalCoordinates(input) {
  const value = String(input ?? '').trim();
  if (!value) return { latitude: null, longitude: null };
  const parts = value.split(/[,;\s]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < 44.05 || latitude > 44.31 ||
      longitude < 66.55 || longitude > 66.94) return null;
  return { latitude, longitude };
}

export function validateSubmission(values) {
  const name = String(values.name || '').trim();
  const category = String(values.category || '');
  const address = String(values.address || '').trim();
  const contact_phone = String(values.contact_phone || '').trim();
  const coords = parseOptionalCoordinates(values.coordinates);
  if (name.length < 2 || name.length > 100)
    return { error: 'Название должно содержать от 2 до 100 символов.' };
  if (!Object.hasOwn(CATEGORIES, category))
    return { error: 'Выберите категорию организации.' };
  if (address.length < 5 || address.length > 200)
    return { error: 'Укажите действительный адрес в Шиели (от 5 до 200 символов).' };
  if (contact_phone.length < 6 || contact_phone.length > 40)
    return { error: 'Укажите контактный телефон (от 6 до 40 символов).' };
  if (!coords)
    return { error: 'Координаты должны быть внутри Шиели: широта, долгота. Или оставьте поле пустым.' };
  // Applicant ID, status and public map properties are intentionally absent.
  return {
    payload: {
      name, category, address, contact_phone,
      latitude: coords.latitude, longitude: coords.longitude
    }
  };
}

export async function submitPlace(supabase, formValues) {
  const result = validateSubmission(formValues);
  if (result.error) return result;
  const { error } = await supabase.from('place_submissions')
    .insert(result.payload); // No RETURNING; RLS enforces applicant ownership.
  if (error) return { error: error.code === '42P01' || error.code === 'PGRST205'
    ? 'Приём заявок ещё не подключён к Supabase (SQL 005).'
    : 'Не удалось отправить заявку. Проверьте подключение и настройки таблицы (код ' +
      String(error.code || 'network').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) + ').' };
  return { success: true };
}

export async function fetchOwnSubmissions(supabase) {
  // SELECT policy returns only the signed-in applicant's rows.
  // No applicant_id from user-controlled browser input is passed.
  const { data, error } = await supabase.from('place_submissions')
    .select('id,name,category,address,status,created_at')
    .order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  return (data || []).filter(item => Object.hasOwn(STATUS_LABELS, item.status));
}
