// Combine paths before queries so endpoint authentication parameters stay intact.
export function buildRestUrl(endpoint: string, path: string): string {
  const base = endpoint.split('#', 1)[0] ?? '';
  const queryIndex = base.indexOf('?');
  const basePath = queryIndex < 0 ? base : base.slice(0, queryIndex);
  const query = new URLSearchParams(queryIndex < 0 ? '' : base.slice(queryIndex + 1));
  const pathQueryIndex = path.indexOf('?');
  const requestPath = pathQueryIndex < 0 ? path : path.slice(0, pathQueryIndex);
  if (pathQueryIndex >= 0) {
    new URLSearchParams(path.slice(pathQueryIndex + 1)).forEach((value, key) => {
      query.set(key, value);
    });
  }
  const encodedQuery = query.toString();
  return `${basePath.replace(/\/+$/, '')}${requestPath}${encodedQuery ? `?${encodedQuery}` : ''}`;
}
