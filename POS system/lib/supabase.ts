import { createClient } from '@supabase/supabase-js';

const getSupabaseUrl = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !url.startsWith('http')) {
    return 'https://placeholder.supabase.co';
  }
  return url;
};

const getSupabaseAnonKey = () => {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    return 'placeholder';
  }
  return key;
};

const supabaseUrl = getSupabaseUrl();
const supabaseAnonKey = getSupabaseAnonKey();

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn('Supabase URL or Anon Key is missing or invalid. Please configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Settings.');
}

export const isConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && 
                           process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('http') &&
                           !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
                           process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== 'placeholder';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
