import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const base=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=(path)=>readFileSync(join(base,path),'utf8');

test('Resident map defaults to fullscreen while retaining normal view',()=>{
  const html=read('client-app/index.html');
  const css=read('client-app/styles.css');
  assert.match(html,/id="mapLayoutToggle"/);
  assert.match(html,/id="placesPanelToggle"/);
  assert.match(html,/id="placesBody"/);
  assert.match(html,/let expandedMap = true/);
  assert.match(html,/localStorage\.getItem\(LAYOUT_KEY\)/);
  assert.match(html,/localStorage\.setItem\(LAYOUT_KEY/);
  assert.match(html,/classList\.toggle\('is-map-expanded', active\)/);
  assert.match(html,/classList\.toggle\('map-expanded', active\)/);
  assert.match(html,/requestAnimationFrame\(\(\) => mapController\.invalidateSize\(\)\)/);
  assert.match(css,/\.app\.is-map-expanded \.topbar\{display:none\}/);
  assert.match(css,/\.app\.is-map-expanded \.tabbar\{/);
  assert.match(css,/\.map-screen\.map-expanded \.categories-panel\{/);
  assert.match(css,/\.map-screen\.map-expanded \.categories-panel\.is-list-open \.places-body\{/);
  assert.match(css,/\.map-screen\.map-expanded \.chip\[aria-pressed=true\]/);
});

test('Taxi filter remains usable without drivers or businesses',()=>{
  const html=read('client-app/index.html');
  const map=read('client-app/map.js');
  const places=read('client-app/places.js');
  assert.match(html,/data-category="taxi"/);
  assert.match(html,/id="taxiInfo"/);
  assert.match(html,/независимо от количества зарегистрированных водителей/);
  assert.match(html,/Список свободных водителей и заказ поездок пока не подключены/);
  assert.match(map,/selectedCategory !== 'taxi'/);
  assert.match(map,/Опубликованных служб такси пока нет/);
  assert.match(map,/Анкеты водителей хранятся отдельно/);
  assert.match(map,/selectedCategory = selected/);
  assert.match(places,/\.from\('map_places'\)/);
  assert.doesNotMatch(places,/driver_registrations|service_role/);
  assert.doesNotMatch(map,/driver_registrations|order\.insert/);
});

test('Fullscreen UI keeps access to existing map and profile features',()=>{
  const html=read('client-app/index.html');
  for(const id of [
    'villageMap','coordinateForm','coordinateInput','locateButton',
    'categoryButtons','placesList','placesRetry','placesCount',
    'mapTab','profileTab','mapScreen','profileScreen'
  ]) assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
  assert.match(html,/if \(isMap && mapController\) requestAnimationFrame/);
  assert.match(html,/mapScreen\.hidden = !isMap/);
  assert.match(html,/profileScreen\.hidden = isMap/);
  const js=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(js);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(()=>new AsyncFunction(js));
});
