export function webUrl(value?: string): URL | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch {
    return;
  }
}

export function urlTransformer(from: URL, to: URL) {
  const source = from.pathname.replace(/\/$/, '');
  const target = to.pathname.replace(/\/$/, '');
  return (value?: string): string | undefined => {
    const original = webUrl(value);
    if (!original || original.origin !== from.origin) return;
    if (original.pathname !== source && !original.pathname.startsWith(source + '/')) return;
    const result = new URL(to.origin);
    result.pathname = target + original.pathname.slice(source.length);
    result.search = original.search;
    result.hash = original.hash;
    if (result.href !== original.href) return result.href;
  };
}
