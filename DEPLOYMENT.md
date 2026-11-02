# DAapp — GitHub Pages (тестовая версия)

Код хранится в рабочей ветке `setup/initial-pwa-scaffold`; `main` до согласования не изменяем.

## Первое включение GitHub Pages — один раз

Автоматическая сборка прошла успешно. Первое развёртывание завершилось ошибкой 404: **Pages ещё не включён**.

1. Откройте https://github.com/AntonDATsagolov/DAapp/settings/pages
2. В **Build and deployment → Source** выберите **GitHub Actions** (не `Deploy from a branch`). Сохраните настройку, если Github запросит.
3. Вернитесь в **Actions → Deploy DAapp preview to GitHub Pages**, откройте неудачный запуск https://github.com/AntonDATsagolov/DAapp/actions/runs/41392223084
4. Выберите **Re-run jobs → Re-run failed jobs**. Альтернатива — новая отправка коммита в рабочую ветку. **Run workflow** может не отображаться, пока файл workflow отсутствует в основной ветке.
5. Убедитесь, что шаг `deploy` завершился статусом **Success**. После этого возьмите реальный URL из **Settings → Pages** или ссылки `github-pages` успешного запуска. До успешной публикации URL сайта считать недоступным.

## Supabase Auth (после публикации)

В Supabase → **Authentication → URL Configuration**:
- добавьте **точный опубликованный адрес** клиентского экрана с завершающим `/` в **Redirect URLs** (обычно `https://antondatsagolov.github.io/DAapp/client-app/`, если GitHub выдал стандартный домен);
- убедитесь, что настроены разрешённые адреса приложения и включён Email provider;
- проверьте получение magic-link и создание профиля. Письмо может не прийти из-за лимитов/настроек почтовой доставки Supabase.

## Что публикуется

Только `client-app/`, `business-app/`, `driver-app/`, `shared/` и корневой переход на приложение жителей.
SQL-миграции, тесты и файлы конфигурации GitHub Actions **не попадают** в архив.
GitHub Pages — публичный хостинг. Не сохраняйте личные данные и секретные ключи в статических файлах.

## Ограничения

Это веб-прототип, а не устанавливаемая офлайн-PWA: `manifest` и `service worker` ещё не добавлены. GitHub Actions проверяет синтаксис и логику с заглушками, а не реальные email-письма, RLS в Supabase или авторизацию живого пользователя. SQL-миграции не выполняются автоматически.
