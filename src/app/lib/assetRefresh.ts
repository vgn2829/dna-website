import { useEffect, useState } from 'react';
const EVENT = 'dna-assets-changed';
export function notifyAssetsChanged(): void {
  window.dispatchEvent(new Event(EVENT));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(EVENT);
    channel.postMessage('refresh');
    channel.close();
  }
}
// Cross-tab changes and focus refresh; server authorization still decides access.
export function useAssetRefresh(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(EVENT, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(EVENT) : null;
    if (channel) channel.onmessage = refresh;
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
      channel?.close();
    };
  }, []);
  return revision;
}
