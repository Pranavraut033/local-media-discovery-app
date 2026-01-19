export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `http://${window.location.hostname}:3001`;
  }

  return 'http://localhost:3001';
}

export function getMediaUrl(mediaId: string): string {
  const base = getApiBase();
  return `${base}/api/media/file/${mediaId}`;
}
