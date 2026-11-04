// DAapp / Шиели: только опубликованные записи публичного каталога.
// Ниже нет INSERT/UPDATE/DELETE, service-role ключей и персональных данных.
export const SHIELI_BOUNDS = Object.freeze({
  south: 44.05, north: 44.31, west: 66.55, east: 66.94
});
export const PLACE_CATEGORIES = Object.freeze(['shop','cafe','beauty','hotel','taxi']);

export function normalizePlace(raw) {
  if (!raw || !PLACE_CATEGORIES.includes(raw.category)) return null;
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 100 ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < SHIELI_BOUNDS.south || latitude > SHIELI_BOUNDS.north ||
      longitude < SHIELI_BOUNDS.west || longitude > SHIELI_BOUNDS.east) return null;
  return {
    id: String(raw.id || ''),
    name,
    category: raw.category,
    address: typeof raw.address === 'string' ? raw.address.trim().slice(0, 200) : '',
    phone: typeof raw.phone === 'string' ? raw.phone.trim().slice(0, 40) : '',
    is_working: typeof raw.is_working === 'boolean' ? raw.is_working : null,
    latitude,
    longitude
  };
}

export function filterPlaces(places, category = 'all') {
  return category === 'all'
    ? places
    : places.filter(place => place.category === category);
}

export async function fetchPublishedPlaces(supabase) {
  // Bounding box avoids downloading unrelated points. RLS separately limits
  // read access to is_published=true. Limit controls traffic on slow 3G.
  const query=(fields)=>supabase.from('map_places')
    .select(fields)
    .eq('is_published', true)
    .gte('latitude', SHIELI_BOUNDS.south)
    .lte('latitude', SHIELI_BOUNDS.north)
    .gte('longitude', SHIELI_BOUNDS.west)
    .lte('longitude', SHIELI_BOUNDS.east)
    .order('name', { ascending: true })
    .limit(150);
  const currentFields='id,name,category,address,phone,latitude,longitude,is_working';
  let {data,error}=await query(currentFields);
  // Deploys happen before the user manually applies SQL 012. Keep the map
  // available during the transition without inventing "closed" status.
  if(error && ['42703','PGRST204'].includes(String(error.code||''))){
    ({data,error}=await query('id,name,category,address,phone,latitude,longitude'));
  }
  if (error) throw error;
  return (data || []).map(normalizePlace).filter(Boolean);
}
