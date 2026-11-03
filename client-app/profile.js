// DAapp: экран профиля жителя.
// Подключается из client-app/index.html. Меняем только разрешённые RLS поля.
import { supabase } from '../shared/supabase.js';

const roleNames = {
  client: 'Житель или гость',
  driver: 'Водитель',
  business_owner: 'Предприниматель'
};

export function createProfileController({ form, fullName, phoneNumber, role, status, saveButton, retryButton }) {
  let userId = null;
  let activeUser = null;
  let version = 0; // Не показываем данные предыдущего пользователя после смены аккаунта.

  function resetFields() {
    form.hidden = true;
    fullName.value = '';
    phoneNumber.value = '';
    role.textContent = '';
    status.textContent = '';
    saveButton.disabled = false;
    if (retryButton) retryButton.hidden = true;
  }

  async function show(user) {
    const currentVersion = ++version;
    userId = user?.id ?? null;
    activeUser = user ?? null;
    resetFields();
    if (!userId) return;

    status.textContent = 'Загружаем ваш профиль…';
    try {
      const review=await supabase.rpc('daapp_account_approved');
      if(currentVersion!==version)return;
      // Allow older DAapp installations before SQL 009 is applied.
      if(review.error && review.error.code!=='PGRST202')throw review.error;
      if(!review.error && review.data!==true) {
        status.textContent='Ваш аккаунт ожидает одобрения. Откройте единый кабинет DAapp для проверки статуса.';
        if(retryButton)retryButton.hidden=false;
        return;
      }
      // Выбираем профиль текущего пользователя. База дополнительно проверяет RLS.
      const readOwnProfile = () => supabase
        .from('profiles')
        .select('id, full_name, phone_number, role, driver_vehicle_type')
        .eq('id', userId)
        .maybeSingle();

      let { data, error } = await readOwnProfile();
      if (currentVersion !== version) return;
      if (error) throw error;

      if (!data) {
        // User may have registered before the profiles trigger existed.
        // A trusted RPC creates ONLY the current user's missing row as 'client'.
        status.textContent = 'Профиль не найден. Пробуем восстановить…';
        const result = await supabase.rpc('daapp_ensure_own_profile');
        if (currentVersion !== version) return;

        if (result.error) {
          console.warn('Восстановление профиля недоступно:', result.error.code || 'rpc_error');
          status.textContent = 'Автоматическое восстановление ещё не настроено. Администратору нужно выполнить SQL 003_ensure_own_profile.sql в Supabase.';
          if (retryButton) retryButton.hidden = false;
          return;
        }

        ({ data, error } = await readOwnProfile());
        if (currentVersion !== version) return;
        if (error) throw error;

        if (!data) {
          status.textContent = 'Профиль создан или уже существует, но не виден. Проверьте SELECT и RLS для profiles (auth.uid() = id).';
          if (retryButton) retryButton.hidden = false;
          return;
        }
      }

      fullName.value = data.full_name ?? '';
      phoneNumber.value = data.phone_number ?? '';
      role.textContent = roleNames[data.role] ?? 'Роль не определена';
      form.hidden = false;
      status.textContent = 'Данные доступны только вашему аккаунту.';
    } catch (error) {
      if (currentVersion !== version) return;
      console.error('Ошибка чтения profiles:', error);
      status.textContent = 'Не удалось прочитать профиль. Проверьте интернет, структуру таблицы profiles и права SELECT/RLS.';
      if (retryButton) retryButton.hidden = false;
    }
  }

  if (retryButton) {
    retryButton.addEventListener('click', () => {
      if (activeUser) void show(activeUser);
    });
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
      activeUser = null;
      resetFields();
    }
  };
}
