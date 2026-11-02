# DAapp — GitHub Pages (тестовая версия)

Код хранится в рабочей ветке `setup/initial-pwa-scaffold`; `main` до согласования не изменяем.

## Первый запуск — один раз в GitHub

1. Откройте репозиторий `AntonDATsagolov/DAapp` → **Settings** → **Pages**.
2. В **Build and deployment → Source** выберите **GitHub Actions**. Не выбирайте «Deploy from a branch».
3. Посмотрите статус сценария **Deploy DAapp preview to GitHub Pages** во вкладке **Actions**. При необходимости запустите workflow повторно через Actions → Run workflow, выбрав `setup/initial-pwa-scaffold`.
4. Дождитесь статуса **Success** именно для задачи `deploy`, после этого скопируйте точный URL из раздела Pages или из ссылки environment `github-pages` в успешном запуске. Не считайте предполагаемый адрес действующим без успешного deploy.

## Supabase Auth

После того как сайт действительно опубликован, откройте Supabase → Authentication → URL Configuration:
- добавьте точный HTTPS-адрес страницы `/DAapp/client-app/` в **Redirect URLs**;
- установите корректный **Site URL** по выбранному домену, если приложение будет основным.
- вход по e-mail требует включённого провайдера Email и работоспособной доставки писем.

## Что публикуется

Только `client-app/`, `business-app/`, `driver-app/`, `shared/` и корневой переход на приложение жителей.
SQL-миграции, исходники тестов и файлы GitHub Actions **не попадают** в архив для Pages.
GitHub Pages — публичный хостинг. Не сохраняйте личные данные и секретные ключи в статических файлах.

## Ограничения текущего этапа

Это веб-прототип, ещё не устанавливаемая офлайн-PWA: нет manifest и service worker. Реальные доступность Auth, RLS, редиректы и сохранение профиля нужно проверить после публикации. Серверная логика здесь не запускается.
