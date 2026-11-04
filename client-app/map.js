// DAapp / Шаг 6. Карта поселка. Работает без авторизации.
// Список организаций и их координаты появятся отдельным этапом разработки.

export const DEFAULT_CENTER = [44.17603, 66.74096]; // Шиели (Шиелі), Кызылординская область — населённый пункт OSM.
export const DEFAULT_ZOOM = 13;

export function parseCoordinates(value) {
  // Пользователь вводит пару десятичных координат: 44.1760, 66.7410
  const parts = String(value).trim().split(/[,;\s]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lat, lon];
}

const leafletSources = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'
];

// Проверенная SRI-подпись стабильного Leaflet 1.9.4 с официального сайта.
const LEAFLET_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';

function loadExternalScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.integrity = LEAFLET_SRI;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(new Error('Не удалось загрузить ' + url));
    };
    document.head.append(script);
  });
}

async function loadLeaflet() {
  if (window.L) return window.L;
  for (const url of leafletSources) {
    try {
      await loadExternalScript(url);
      if (window.L) return window.L;
    } catch (error) {
      console.warn('DAapp: Leaflet CDN недоступен', error);
    }
  }
  throw new Error('Библиотека карты Leaflet недоступна');
}

const categoryNames = {
  all: 'организации',
  shop: 'магазины',
  cafe: 'кафе',
  beauty: 'салоны красоты',
  hotel: 'гостиницы',
  taxi: 'такси'
};

export async function initVillageMap({
  mapElement, mapStatus, retryButton, locateButton,
  categories, emptyText, placesList, placesRetry, placesCount, taxiInfo,
  coordinateForm, coordinateInput, mapLocation
}) {
  let map;
  let currentPoint;
  let accuracyCircle;
  let markerLayer;
  let places = [];
  let selectedCategory = 'all';
  let catalogState = 'loading';

  const placeTypeLabels = {
    shop: 'Магазин', cafe: 'Кафе', beauty: 'Красота',
    hotel: 'Гостиница', taxi: 'Такси'
  };

  function renderCatalog() {
    // Published taxi ORGANISATIONS and approved DRIVER accounts are separate.
    // Show an honest service state without pretending that order booking exists.
    if (taxiInfo) taxiInfo.hidden = selectedCategory !== 'taxi';
    placesList.replaceChildren();
    if (markerLayer) markerLayer.clearLayers();
    placesRetry.hidden = catalogState !== 'error' && catalogState !== 'unconfigured';

    if (catalogState === 'loading') {
      placesCount.textContent = 'Загружаем…';
      emptyText.textContent = 'Загружаем проверенные организации Шиели…';
      placesList.hidden = true;
      return;
    }
    if (catalogState === 'error' || catalogState === 'unconfigured') {
      placesCount.textContent = 'Каталог недоступен';
      emptyText.textContent = catalogState === 'unconfigured'
        ? 'Каталог организаций ещё не создан в Supabase. Требуется миграция 004.'
        : 'Каталог сейчас недоступен. Карта Шиели работает независимо от него.';
      placesList.hidden = true;
      return;
    }

    const visible = selectedCategory === 'all'
      ? places : places.filter(place => place.category === selectedCategory);
    placesCount.textContent = visible.length + ' из ' + places.length;
    placesList.hidden = visible.length === 0;
    emptyText.textContent = visible.length === 0
      ? (selectedCategory === 'taxi'
        ? 'Опубликованных служб такси пока нет. Анкеты водителей хранятся отдельно; заказы поездок ещё не подключены.'
        : places.length === 0
          ? 'Пока нет опубликованных проверенных организаций Шиели.'
          : 'В этой категории пока нет опубликованных организаций.')
      : 'Нажмите на организацию, чтобы показать её на карте.';

    for (const place of visible) {
      // Database values are ALWAYS written with textContent, never innerHTML.
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'place-item';
      const title = document.createElement('strong');
      title.textContent = place.name;
      item.append(title);
      const description = document.createElement('span');
      description.textContent = placeTypeLabels[place.category] +
        (place.address ? ' · ' + place.address : '');
      item.append(description);
      placesList.append(item);

      if (!markerLayer || !map) continue;
      const pin = window.L.circleMarker([place.latitude, place.longitude], {
        radius: 8, weight: 2, color: '#fff', fillColor: '#17634c',
        fillOpacity: 0.95
      }).addTo(markerLayer);
      const popup = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = place.name;
      popup.append(name);
      if (place.address) {
        const address = document.createElement('p');
        address.textContent = place.address;
        address.style.margin = '5px 0';
        popup.append(address);
      }
      if (place.phone) {
        const phone = document.createElement('p');
        phone.textContent = 'Телефон: ' + place.phone;
        phone.style.margin = '5px 0';
        popup.append(phone);
      }
      pin.bindPopup(popup);
      item.addEventListener('click', () => {
        map.setView([place.latitude, place.longitude], Math.max(map.getZoom(), 16), {
          animate: false
        });
        pin.openPopup();
      });
    }
  }

  async function loadCatalog() {
    catalogState = 'loading';
    renderCatalog();
    try {
      // The catalog is optional. The map itself remains available if Supabase
      // or its CDN is unavailable. No user login or geolocation is required.
      const [{ supabase }, { fetchPublishedPlaces }] = await Promise.all([
        import('../shared/supabase.js'),
        import('./places.js')
      ]);
      places = await fetchPublishedPlaces(supabase);
      catalogState = 'ready';
    } catch (error) {
      const code = String(error?.code || '');
      console.warn('Каталог мест DAapp недоступен:', code || 'network_error');
      catalogState = code === 'PGRST205' || code === '42P01'
        ? 'unconfigured' : 'error';
    }
    renderCatalog();
  }

  const status = (text) => { mapStatus.textContent = text; };
  const showMapError = (text) => {
    status(text);
    retryButton.hidden = false;
  };

  function showPoint(lat, lng, accuracy) {
    if (currentPoint) map.removeLayer(currentPoint);
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    currentPoint = window.L.circleMarker([lat, lng], {
      radius: 8, weight: 3, color: '#ffffff', fillColor: '#1769d2', fillOpacity: 1
    }).addTo(map);
    if (accuracy && Number.isFinite(accuracy)) {
      accuracyCircle = window.L.circle([lat, lng], {
        radius: accuracy, weight: 1, color: '#1769d2', fillColor: '#1769d2', fillOpacity: 0.09
      }).addTo(map);
    }
    map.setView([lat, lng], 15);
  }

  async function start() {
    retryButton.hidden = true;
    status('Загружаем карту…');
    try {
      const L = await loadLeaflet();
      if (!map) {
        map = L.map(mapElement, {
          zoomControl: false, scrollWheelZoom: false, preferCanvas: true
        }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          minZoom: 3, maxZoom: 19, updateWhenIdle: true, keepBuffer: 1
        }).addTo(map);
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        markerLayer = L.layerGroup().addTo(map);
        renderCatalog();
        map.on('tileerror', () => {
          status('Часть карты не загрузилась. Проверьте интернет.');
        });
      }
      status('');
      map.invalidateSize();
    } catch (error) {
      console.error('Ошибка загрузки карты', error);
      showMapError('Карта пока недоступна. Проверьте интернет и нажмите «Повторить».');
    }
  }

  retryButton.addEventListener('click', () => { void start(); });
  placesRetry.addEventListener('click', () => { void loadCatalog(); });

  locateButton.addEventListener('click', () => {
    if (!map) {
      status('Сначала загрузите карту.');
      return;
    }
    if (!navigator.geolocation) {
      status('Ваш браузер не поддерживает геолокацию.');
      return;
    }
    locateButton.disabled = true;
    status('Определяем местоположение…');
    navigator.geolocation.getCurrentPosition(
      ({coords}) => {
        locateButton.disabled = false;
        showPoint(coords.latitude, coords.longitude, coords.accuracy);
        mapLocation.textContent = 'Моё местоположение';
        status('Точка на карте показана приблизительно.');
      },
      (error) => {
        locateButton.disabled = false;
        status(error.code === 1
          ? 'Доступ к геолокации запрещён. Разрешите его в настройках браузера.'
          : 'Не удалось определить местоположение. Попробуйте ещё раз.');
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 }
    );
  });

  coordinateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const position = parseCoordinates(coordinateInput.value);
    if (!position) {
      status('Введите широту и долготу через запятую, например: 44.1760, 66.7410');
      return;
    }
    if (!map) {
      status('Карта ещё не загрузилась.');
      return;
    }
    showPoint(position[0], position[1]);
    mapLocation.textContent = 'Выбранная точка';
    status('Карта перемещена к указанным координатам.');
  });

  categories.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-category]');
    if (!button || !categories.contains(button)) return;
    const selected = button.dataset.category;
    if (!(selected in categoryNames)) return;
    for (const item of categories.querySelectorAll('button[data-category]')) {
      item.setAttribute('aria-pressed', String(item === button));
    }
    selectedCategory = selected;
    renderCatalog();
  });

  renderCatalog();
  await start();
  void loadCatalog();
  return {
    invalidateSize() { if (map) map.invalidateSize(); }
  };
}
