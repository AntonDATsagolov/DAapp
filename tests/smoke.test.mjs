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


test('All three DAapp interfaces target Shieli', () => {
  for (const dir of ['client-app', 'business-app', 'driver-app']) {
    assert.match(read(dir + '/index.html'), /Шиели/);
  }
  assert.match(read('README.md'), /посёлка Шиели/);
});

test('Map module parses coordinates and rejects invalid positions', () => {
  const source = read('client-app/map.js')
    .replace(/^export /gm, '');
  const parseCoordinates = new Function(source + '\nreturn parseCoordinates;')();

  assert.deepEqual(parseCoordinates('44.1760, 66.7410'), [44.176, 66.741]);
  assert.deepEqual(parseCoordinates('44.8528;65.5092'), [44.8528, 65.5092]);
  assert.equal(parseCoordinates('91, 65'), null);
  assert.equal(parseCoordinates('44, 181'), null);
  assert.equal(parseCoordinates('не координаты'), null);
  assert.equal(parseCoordinates(''), null);
  assert.ok(source.includes('DEFAULT_CENTER = [44.17603, 66.74096]'),
    'Default map must be centered on Shieli, not Kyzylorda');
  assert.equal(new Function(source + '\nreturn DEFAULT_ZOOM;')(), 13);
  assert.ok(source.includes('tile.openstreetmap.org'));
  assert.match(source, /OpenStreetMap/);
  assert.ok(source.includes('navigator.geolocation'));
});

test('Mobile DAapp map is publicly accessible without login', () => {
  const html = read('client-app/index.html');
  const css = read('client-app/styles.css');
  assert.match(html, /<strong id="mapLocation">Шиели · Шиелі<\/strong>/);
  assert.match(html, /Кызылординская область/);
  assert.match(html, /id="villageMap"/);
  assert.match(html, /id="mapTab"/);
  assert.match(html, /id="profileTab"/);
  assert.match(html, /id="categoryButtons"/);
  assert.ok(html.includes("import('./map.js')"));
  assert.match(html, /createProfileController/);
  assert.match(html, /id="loginForm"/);
  assert.match(css, /height:100dvh/);
  assert.match(css, /overflow-x:auto/);
  assert.ok(html.indexOf("import('./map.js')") < html.indexOf("import('../shared/supabase.js')"),
    'map must start before Supabase login');
});

test('Shieli public places validate records and filter by category', async () => {
  const source = read('client-app/places.js').replace(/^export /gm, '');
  const { normalizePlace, filterPlaces, fetchPublishedPlaces } =
    new Function(source + '\nreturn { normalizePlace, filterPlaces, fetchPublishedPlaces };')();

  const good = {
    id: 'a', name: '  Проверенная точка  ', category: 'shop',
    address: 'ул. Примерная, 1', latitude: 44.18, longitude: 66.74
  };
  assert.equal(normalizePlace(good).name, 'Проверенная точка');
  assert.equal(normalizePlace({ ...good, category: 'unknown' }), null);
  assert.equal(normalizePlace({ ...good, latitude: 1 }), null);
  assert.equal(normalizePlace({ ...good, longitude: 1 }), null);
  assert.equal(normalizePlace({ ...good, name: '' }), null);
  assert.equal(filterPlaces([normalizePlace(good)], 'cafe').length, 0);
  assert.equal(filterPlaces([normalizePlace(good)], 'shop').length, 1);

  const steps = [];
  const rows = [good, { ...good, id: 'b', category: 'cafe' }];
  const fake = {
    from(table) {
      assert.equal(table, 'map_places');
      const chain = {
        select(fields) {
          assert.equal(fields, 'id,name,category,address,phone,latitude,longitude');
          steps.push('select'); return chain;
        },
        eq(key, value) {
          assert.equal(key, 'is_published');
          assert.equal(value, true); steps.push('published'); return chain;
        },
        gte() { steps.push('gte'); return chain; },
        lte() { steps.push('lte'); return chain; },
        order(key) { assert.equal(key, 'name'); return chain; },
        async limit(max) {
          assert.equal(max, 150); steps.push('limit');
          return { data: rows, error: null };
        }
      };
      return chain;
    }
  };
  const result = await fetchPublishedPlaces(fake);
  assert.equal(result.length, 2);
  assert.ok(steps.includes('published'));
  assert.equal(steps.filter(x => x === 'gte').length, 2);
  assert.equal(steps.filter(x => x === 'lte').length, 2);
  assert.ok(steps.includes('limit'));
  for (const action of ['.insert(', '.update(', '.delete(']) assert.ok(!source.includes(action));
});

test('Shieli place migration is admin-write-only with published-row RLS', () => {
  const sql = read('supabase/migrations/004_shieli_public_map_places.sql');
  assert.ok(sql.includes("to_regclass('public.map_places')"));
  assert.ok(sql.includes('alter table public.map_places enable row level security'));
  assert.match(sql, /for select to anon, authenticated/);
  assert.ok(sql.includes('using (is_published = true)'));
  assert.match(sql, /default false/);
  assert.ok(sql.includes('revoke all on public.map_places from public, anon, authenticated'));
  assert.ok(sql.includes('grant select ('));
  assert.doesNotMatch(sql, /grant (insert|update|delete)/i);
});

test('Business applications validate Shieli data and never choose user ID or status', async () => {
  const source = read('business-app/submissions.js').replace(/^export /gm, '');
  const { validateSubmission, parseOptionalCoordinates, submitPlace, fetchOwnSubmissions } =
    new Function(source + '\nreturn {validateSubmission, parseOptionalCoordinates, submitPlace, fetchOwnSubmissions};')();
  const input = {
    name: '  Магазин для теста  ', category: 'shop',
    address: 'Шиели, улица Тестовая, 7',
    contact_phone: '+7 700 123 45 67', coordinates: ''
  };
  const validated = validateSubmission(input);
  assert.ok(validated.payload);
  assert.deepEqual(Object.keys(validated.payload).sort(),
    ['address','category','contact_phone','latitude','longitude','name']);
  assert.equal(validated.payload.latitude, null);
  assert.equal(validated.payload.longitude, null);
  assert.equal(validated.payload.name, 'Магазин для теста');
  assert.deepEqual(parseOptionalCoordinates('44.176, 66.74'), {latitude:44.176, longitude:66.74});
  assert.equal(parseOptionalCoordinates('44.1, 65.0'), null);
  assert.equal(parseOptionalCoordinates('1,2'), null);
  assert.ok(validateSubmission({ ...input, category: 'owner' }).error);
  assert.ok(validateSubmission({ ...input, coordinates: 'invalid' }).error);
  assert.ok(validateSubmission({ ...input, name: '<' }).error);

  let submitted;
  const client = {
    from(table) {
      assert.equal(table, 'place_submissions');
      return {
        async insert(payload) {
          submitted = payload;
          return { error: null };
        },
        select(columns) {
          assert.equal(columns, 'id,name,category,address,status,created_at');
          return {
            order(column, options) {
              assert.equal(column, 'created_at');
              assert.equal(options.ascending, false);
              return { async limit(size) {
                assert.equal(size, 20);
                return {data: [{name:'Тест',status:'pending'}],error:null};
              } };
            }
          };
        }
      };
    }
  };
  assert.equal((await submitPlace(client, input)).success, true);
  assert.deepEqual(Object.keys(submitted).sort(), Object.keys(validated.payload).sort());
  const own = await fetchOwnSubmissions(client);
  assert.equal(own.length,1);
  assert.equal(own[0].status,'pending');
  assert.ok(!source.includes('.update('));
  assert.ok(!source.includes('.delete('));
});

test('Migration 005: applicant-only RLS and no browser moderation permissions', () => {
  const sql = read('supabase/migrations/005_shieli_place_submissions.sql');
  assert.ok(sql.includes("to_regclass('public.place_submissions')"));
  assert.ok(sql.includes("default auth.uid()"));
  assert.ok(sql.includes("default 'pending'"));
  assert.ok(sql.includes('alter table public.place_submissions enable row level security'));
  assert.ok(sql.includes('using (applicant_id = (select auth.uid()))'));
  assert.ok(sql.includes("with check (applicant_id = (select auth.uid()) and status = 'pending')"));
  assert.ok(sql.includes('revoke all on public.place_submissions from public, anon, authenticated'));
  assert.ok(sql.includes('grant insert (name, category, address, contact_phone, latitude, longitude)'));
  assert.ok(!sql.includes('grant update'));
  assert.ok(!sql.includes('grant delete'));
  assert.ok(!sql.includes('alter table public.map_places'));
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
    'client-app/places.js',
    'business-app/submissions.js',
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
  assert.ok(sql.includes("to_regclass('public.profiles')"));
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
