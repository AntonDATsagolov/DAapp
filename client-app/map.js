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
  categories, emptyText, coordinateForm, coordinateInput, mapLocation
}) {
  let map;
  let currentPoint;
  let accuracyCircle;

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
    emptyText.textContent = selected === 'all'
      ? 'Организации появятся здесь, когда мы добавим их адреса на карту.'
      : 'Категория «' + categoryNames[selected] + '» пока без подключённых организаций.';
  });

  await start();
  return {
    invalidateSize() { if (map) map.invalidateSize(); }
  };
}
