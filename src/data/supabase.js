import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !KEY) throw new Error('Konfigurasi Supabase belum diisi (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).');

export const SUPABASE_URL = URL;
export const sb = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'kas-keluarga-sesi' },
});
