
import { supabase } from './lib/supabase';

async function checkSchema() {
  const { data, error } = await supabase.from('products').select('*').limit(1);
  if (error) {
    console.error('Error fetching product:', error);
  } else {
    console.log('Product fields:', Object.keys(data[0] || {}));
    console.log('Sample product:', data[0]);
  }
}

checkSchema();
