export interface StorageProvider {
  upload(path: string, buffer: Buffer, mimeType: string): Promise<void>;
  getPublicUrl(path: string): string;
  delete(path: string): Promise<void>;
}

let _provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (_provider) return _provider;

  const hasUrl = Boolean(process.env.SUPABASE_URL);
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (hasUrl && hasKey) {
    const { SupabaseStorageProvider } = require('./supabase') as typeof import('./supabase');
    _provider = new SupabaseStorageProvider();
  } else {
    const { LocalStorageProvider } = require('./local') as typeof import('./local');
    _provider = new LocalStorageProvider();
  }

  return _provider!;
}
