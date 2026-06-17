import { createClient } from '@supabase/supabase-js';
import type { StorageProvider } from './index';

function client() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const bucket = () => process.env.SUPABASE_STORAGE_BUCKET ?? 'dna-media';

export class SupabaseStorageProvider implements StorageProvider {
  async upload(path: string, buffer: Buffer, mimeType: string): Promise<void> {
    const { error } = await client().storage
      .from(bucket())
      .upload(path, buffer, { contentType: mimeType, upsert: true });
    if (error) {
      console.error('Supabase storage upload error:', error);
      throw new Error(`Storage upload failed: ${error.message}`);
    }
  }

  getPublicUrl(path: string): string {
    const { data } = client().storage.from(bucket()).getPublicUrl(path);
    return data.publicUrl;
  }

  async delete(path: string): Promise<void> {
    const { error } = await client().storage.from(bucket()).remove([path]);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }
}
