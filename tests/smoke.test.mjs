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

test('Shared Supabase and client profile modules have valid JS', () => {
  let shared = read('shared/supabase.js');
  shared = shared.replace(/^import .*;$/gm, '').replace(/export const/g, 'const');
  assert.doesNotThrow(() => new Function('createClient', shared));

  let profile = read('client-app/profile.js');
  profile = profile.replace(/^import .*;$/gm, '').replace('export function', 'function');
  assert.doesNotThrow(() => new Function('supabase', profile));
});

test('Public repository sources never contain a Supabase secret key', () => {
  const paths = [
    'shared/supabase.js',
    'client-app/index.html',
    'client-app/profile.js',
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

  const fakeSupabase = {
    from(table) {
      assert.equal(table, 'profiles');
      let userId = null;
      let payload = null;
      const query = {
        select() { return query; },
        eq(column, value) { assert.equal(column, 'id'); userId = value; return query; },
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
  const controller = createFactory(fakeSupabase)({ form, fullName, phoneNumber, role, status, saveButton });

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
  assert.equal(form.hidden, true);
  assert.match(status.textContent, /Профиль не найден/);
});
