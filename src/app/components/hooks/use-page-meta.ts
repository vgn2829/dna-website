import { useEffect } from 'react';

interface PageMeta {
  title: string;
  description: string;
  /** Path only, e.g. "/gallery" — combined with the site origin for canonical/og:url. */
  path: string;
}

const SITE_URL = 'https://www.dnaiitk.site';

function setMetaTag(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

// Mutates document.title and the title/description/canonical/OG/Twitter meta
// tags on mount and whenever the route changes. This makes each page's tags
// distinct for Google's renderer (which executes JS before indexing) and
// most modern crawlers.
//
// LIMITATION: crawlers that DON'T execute JavaScript — some social-media link
// unfurlers (older Slack/Discord/WhatsApp previews, curl-based scrapers) —
// only ever see index.html's static tags, so shared links may still show the
// homepage's title/description/OG image rather than the specific page's.
// Fixing that fully requires SSR/prerendering, which this app doesn't have.
export function usePageMeta({ title, description, path }: PageMeta) {
  useEffect(() => {
    const url = `${SITE_URL}${path}`;

    document.title = title;
    setMetaTag('name', 'description', description);
    setCanonical(url);

    setMetaTag('property', 'og:url', url);
    setMetaTag('property', 'og:title', title);
    setMetaTag('property', 'og:description', description);

    setMetaTag('name', 'twitter:title', title);
    setMetaTag('name', 'twitter:description', description);
  }, [title, description, path]);
}
