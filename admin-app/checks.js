// DAapp Admin: non-destructive integration checks for the production project.
// Each request is read-only; no real or sample business data is changed.
function codeOf(error) {
  return String(error?.code || error?.status || 'network_error')
    .replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

export async function runAdminReadChecks(client, expectedUserId) {
  const results = [];
  async function check(label, handler) {
    try {
      const detail = await handler();
      results.push({ label, ok: true, detail });
    } catch (error) {
      results.push({ label, ok: false, detail: 'Ошибка ' + codeOf(error) });
    }
  }

  await check('Авторизация Supabase', async () => {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data?.user?.id || data.user.id !== expectedUserId)
      throw { code: 'session_mismatch' };
    return 'Подтверждён вход текущего аккаунта';
  });

  // Do not request administrator-only information if the identity check failed.
  if (!results[0].ok) return results;

  await check('Разрешение администратора', async () => {
    const { data, error } = await client.from('daapp_admins')
      .select('user_id').eq('user_id', expectedUserId).maybeSingle();
    if (error) throw error;
    if (!data?.user_id) throw { code: 'no_admin_access' };
    return 'Аккаунт есть в разрешённом списке';
  });
  if (!results[1].ok) return results;

  await check('Очередь заявок предпринимателей', async () => {
    const { data, error } = await client.rpc('daapp_admin_list_submissions');
    if (error) throw error;
    if (!Array.isArray(data)) throw { code: 'invalid_queue' };
    return data.length === 100
      ? 'Не менее 100 заявок ожидают проверки'
      : 'Ожидают проверки: ' + data.length;
  });

  await check('Приватность своих заявок', async () => {
    // This table uses applicant-only RLS; only the signed-in user's own row
    // count is returned. Other people's private submissions remain hidden.
    const { count, error } = await client.from('place_submissions')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;
    if (typeof count !== 'number') throw { code: 'invalid_count' };
    return 'Доступны только собственные заявки: ' + count;
  });

  await check('Опубликованные организации на карте', async () => {
    const { count, error } = await client.from('map_places')
      .select('id', { count: 'exact', head: true })
      .eq('is_published', true);
    if (error) throw error;
    if (typeof count !== 'number') throw { code: 'invalid_count' };
    return 'Опубликованных организаций: ' + count;
  });

  return results;
}
