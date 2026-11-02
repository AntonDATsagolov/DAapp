// DAapp smoke tests. Run: node --test tests/smoke.test.mjs
// No network, no real Supabase users, no secret keys are required.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('Three mobile screens have valid inline JS and viewport metadata', () => {
  for (const dir of ['client-app', 'business-app', 'driver-app']) {
    const html = read(dir + '/index.html');
    assert.match(html, /<meta name="viewport"/);
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, dir + ': missing module script');
    assert.doesNotThrow(() => new AsyncFunction(script), dir + ': invalid inline JS');
    assert.match(script, /\.\.\/shared\/supabase\.js/);
  }
});

test('Diagnostics page has valid inline JavaScript', () => {
  const html = read('diagnostics/index.html');
  assert.match(html, /DAapp · Диагностика/);
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new AsyncFunction(script));
});

test('Shared Supabase and client profile modules have valid JS', () => {
  let shared = read('shared/supabase.js');
  shared = shared.replace(/^import .*;$/gm, '').replace(/export const/g, 'const');
  assert.doesNotThrow(() => new AsyncFunction(shared));
  assert.ok(shared.includes('esm.sh'));

  let profile = read('client-app/profile.js');
  profile = profile.replace(/^import .*;$/gm, '').replace('export function', 'function');
  assert.doesNotThrow(() => new Function('supabase', profile));
});


test('Map module parses coordinates and rejects invalid positions', () => {
  const source = read('client-app/map.js')
    .replace(/^export /gm, '');
  const parseCoordinates = new Function(source + '\nreturn parseCoordinates;')();

  assert.deepEqual(parseCoordinates('44.8528, 65.5092'), [44.8528, 65.5092]);
  assert.deepEqual(parseCoordinates('44.8528;65.5092'), [44.8528, 65.5092]);
  assert.equal(parseCoordinates('91, 65'), null);
  assert.equal(parseCoordinates('44, 181'), null);
  assert.equal(parseCoordinates('не координаты'), null);
  assert.equal(parseCoordinates(''), null);
  assert.match(source, /tile\\.openstreetmap\\.org/);
  assert.match(source, /OpenStreetMap/);
  assert.match(source, /navigator\\.geolocation/);
});

test('Mobile DAapp map is publicly accessible without login', () => {
  const html = read('client-app/index.html');
  const css = read('client-app/styles.css');
  assert.match(html, /id="villageMap"/);
  assert.match(html, /id="mapTab"/);
  assert.match(html, /id="profileTab"/);
  assert.match(html, /id="categoryButtons"/);
  assert.match(html, /import\\('\.\\/map\\.js'\\)/);
  assert.match(html, /createProfileController/);
  assert.match(html, /id="loginForm"/);
  assert.match(css, /height:100dvh/);
  assert.match(css, /overflow-x:auto/);
  assert.ok(html.indexOf("import('./map.js')") < html.indexOf("import('../shared/supabase.js')"),
    'map must start before Supabase login');
});

test('Profile backfill migration preserves existing rows and client-only default', () => {
  const sql = read('supabase/migrations/002_backfill_existing_profiles.sql');
  assert.match(sql, /insert into public\.profiles \(id, role\)/);
  assert.match(sql, /select u\.id, 'client'/);
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.profiles/i);
  assert.doesNotMatch(sql, /update\s+public\.profiles/i);
});

test('Self-repair migration cannot create arbitrary users or elevate roles', () => {
  const sql = read('supabase/migrations/003_ensure_own_profile.sql');
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /caller_id := auth\.uid\(\)/);
  assert.match(sql, /values \(caller_id, 'client'\)/);
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /revoke all on function public\.daapp_ensure_own_profile\(\)/);
  assert.match(sql, /grant execute on function public\.daapp_ensure_own_profile\(\)\s+to authenticated/);
  assert.doesNotMatch(sql, /grant execute .* to anon/i);
});

test('Public repository sources never contain a Supabase secret key', () => {
  const paths = [
    'shared/supabase.js',
    'client-app/index.html',
    'client-app/profile.js',
    'client-app/map.js',
    'business-app/index.html',
    'driver-app/index.html'
  ];
  for (const path of paths) {
    assert.doesNotMatch(read(path), /sb_secret_[A-Za-z0-9_-]{10,}/);
  }
});

test('Profiles migration has RLS and column-restricted updates', () => {
  const sql = read('supabase/migrations/001_profiles_initial.sql');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /profile_read_self/);
  assert.match(sql, /profile_update_self/);
  assert.match(sql, /grant update\s*\(\s*full_name\s*,\s*phone_number\s*\)/);
  assert.match(sql, /to_regclass\('public\.profiles'\)/);
});

test('Profile can load, save only permitted fields, clear, and handle missing rows', async () => {
  const source = read('client-app/profile.js')
    .replace(/^import .*;$/gm, '')
    .replace('export function', 'function');
  const createFactory = new Function('supabase', source + '\nreturn createProfileController;');

  const database = {
    u1: { id: 'u1', full_name: 'Тест', phone_number: '777', role: 'client', driver_vehicle_type: null }
  };
  let writeCount = 0;
  let lastWrittenKeys = [];
  let lastSelectedId = null;
  let rpcCalls = 0;
  let rpcEnabled = true;

  const fakeSupabase = {
    async rpc(name, args) {
      assert.equal(name, 'daapp_ensure_own_profile');
      assert.equal(args, undefined, 'Do not pass user ID or role to RPC');
      rpcCalls++;
      if (!rpcEnabled) return { error: { code: 'PGRST202' } };
      database[lastSelectedId] ??= {
        id: lastSelectedId, full_name: null, phone_number: null,
        role: 'client', driver_vehicle_type: null
      };
      return { data: true, error: null };
    },
    from(table) {
      assert.equal(table, 'profiles');
      let userId = null;
      let payload = null;
      const query = {
        select() { return query; },
        eq(column, value) { assert.equal(column, 'id'); userId = value; lastSelectedId = value; return query; },
        update(value) { payload = value; return query; },
        async maybeSingle() { return { data: database[userId] ?? null, error: null }; },
        async single() {
          assert.ok(database[userId], 'row must exist');
          writeCount++;
          lastWrittenKeys = Object.keys(payload).sort();
          Object.assign(database[userId], payload);
          return {
            data: { full_name: database[userId].full_name, phone_number: database[userId].phone_number },
            error: null
          };
        }
      };
      return query;
    }
  };

  let onSubmit;
  const form = { hidden: true, addEventListener: (type, handler) => {
    if (type === 'submit') onSubmit = handler;
  } };
  const fullName = { value: '' };
  const phoneNumber = { value: '' };
  const role = { textContent: '' };
  const status = { textContent: '' };
  const saveButton = { disabled: false };
  let retryHandler;
  const retryButton = { hidden: true, addEventListener(_type, handler) { retryHandler = handler; } };
  const controller = createFactory(fakeSupabase)({
    form, fullName, phoneNumber, role, status, saveButton, retryButton
  });

  await controller.show({ id: 'u1' });
  assert.equal(form.hidden, false);
  assert.equal(fullName.value, 'Тест');
  assert.equal(role.textContent, 'Житель или гость');

  fullName.value = '  Новое имя  ';
  phoneNumber.value = ' +77010000000 ';
  await onSubmit({ preventDefault() {} });
  assert.equal(database.u1.full_name, 'Новое имя');
  assert.equal(database.u1.phone_number, '+77010000000');
  assert.deepEqual(lastWrittenKeys, ['full_name', 'phone_number']);

  fullName.value = 'x'.repeat(81);
  await onSubmit({ preventDefault() {} });
  assert.equal(writeCount, 1, 'invalid input should not be written');

  controller.clear();
  assert.equal(form.hidden, true);
  assert.equal(fullName.value, '');

  await controller.show({ id: 'missing' });
  assert.equal(form.hidden, false, 'missing profile should recover automatically');
  assert.equal(database.missing.role, 'client', 'never elevate new users');
  assert.equal(role.textContent, 'Житель или гость');
  assert.equal(rpcCalls, 1, 'one recovery call only');
  assert.equal(retryButton.hidden, true, 'hide retry when recovered');

  controller.clear();
  rpcEnabled = false;
  await controller.show({ id: 'needs-setup' });
  assert.equal(form.hidden, true, 'no profile form when RPC has not been installed');
  assert.equal(retryButton.hidden, false, 'offer retry after administrator runs SQL');
  assert.match(status.textContent, /003_ensure_own_profile/);

  rpcEnabled = true;
  retryHandler();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(form.hidden, false, 'retry should recover missing profile after setup');
  assert.equal(database['needs-setup'].role, 'client');
});
