export function requestUrl(request: Request, pathname: string) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  const internalHost=!host||/^(0\.0\.0\.0|127\.0\.0\.1|localhost)(:\d+)?$/i.test(host);
  const configured=process.env.APP_URL?.trim();
  const origin=internalHost&&configured?configured.replace(/\/$/,""):host?`${protocol}://${host}`:new URL(request.url).origin;
  return new URL(pathname, origin);
}
