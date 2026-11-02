// DAapp: экран профиля жителя.
// Подключается из client-app/index.html. Меняем только разрешённые RLS поля.
import { supabase } from '../shared/supabase.js';

const roleNames = {
  client: 'Житель или гость',
  driver: 'Водитель',
  business_owner: 'Предприниматель'
};

export function createProfileController({ form, fullName, phoneNumber, role, status, saveButton }) {
  let userId = null;
  let version = 0; // Не показываем данные предыдущего пользователя после смены аккаунта.

  function resetFields() {
    form.hidden = true;
    fullName.value = '';
    phoneNumber.value = '';
    role.textContent = '';
    status.textContent = '';
    saveButton.disabled = false;
  }

  async function show(user) {
    const currentVersion = ++version;
    userId = user?.id ?? null;
    resetFields();
    if (!userId) return;

    status.textContent = 'Загружаем ваш профиль…';
    try {
      // Выбираем профиль текущего пользователя. База дополнительно проверяет RLS.
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number, role, driver_vehicle_type')
        .eq('id', userId)
        .maybeSingle();

      if (currentVersion !== version) return;
      if (error) throw error;
      if (!data) {
        status.textContent = 'Профиль не найден. Проверьте, что в Supabase настроено автоматическое создание profiles при регистрации.';
        return;
      }

      fullName.value = data.full_name ?? '';
      phoneNumber.value = data.phone_number ?? '';
      role.textContent = roleNames[data.role] ?? 'Роль не определена';
      form.hidden = false;
      status.textContent = 'Данные доступны только вашему аккаунту.';
    } catch (error) {
      if (currentVersion !== version) return;
      console.error('Ошибка чтения profiles:', error);
      status.textContent = 'Не удалось загрузить профиль. Проверьте таблицу profiles и её RLS-политики.';
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!userId || form.hidden) return;

    const currentVersion = version;
    const currentUserId = userId;
    const name = fullName.value.trim();
    const phone = phoneNumber.value.trim();

    if (name.length > 80 || phone.length > 25) {
      status.textContent = 'Имя должно быть не длиннее 80 символов, телефон — 25 символов.';
      return;
    }

    saveButton.disabled = true;
    status.textContent = 'Сохраняем изменения…';
    try {
      // role, driver_vehicle_type и id НЕ передаются — пользователь не может менять роль.
      const { data, error } = await supabase
        .from('profiles')
        .update({ full_name: name || null, phone_number: phone || null })
        .eq('id', currentUserId)
        .select('full_name, phone_number')
        .single();

      if (currentVersion !== version) return;
      if (error) throw error;
      fullName.value = data.full_name ?? '';
      phoneNumber.value = data.phone_number ?? '';
      status.textContent = 'Профиль сохранён.';
    } catch (error) {
      if (currentVersion !== version) return;
      console.error('Ошибка сохранения profiles:', error);
      status.textContent = 'Не удалось сохранить. Проверьте подключение и права обновления profiles.';
    } finally {
      if (currentVersion === version) saveButton.disabled = false;
    }
  });

  return {
    show,
    clear() {
      ++version;
      userId = null;
      resetFields();
    }
  };
}
