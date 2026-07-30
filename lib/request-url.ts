export function requestUrl(request: Request, pathname: string) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  return new URL(pathname, host ? `${protocol}://${host}` : request.url);
}
