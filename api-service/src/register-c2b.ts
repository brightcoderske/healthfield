import { buildC2bCallbackUrls, mpesaConfiguration, registerC2bUrls } from "./mpesa";

const config = mpesaConfiguration();
if (!config) {
  console.error("M-Pesa is not configured. Set the MPESA_* variables in the API environment before registering C2B URLs.");
  process.exit(1);
}

const urls = buildC2bCallbackUrls(config.callbackBaseUrl, config.callbackSecret);
// The callback secret is the last path segment of both URLs, so only the shape is logged.
const withoutSecret = (url: string) => url.replace(/\/[^/]+$/, "/[redacted]");
console.log("Registering the Healthfield C2B callback URLs", {
  shortcodeSuffix: (process.env.MPESA_C2B_SHORTCODE?.trim() || config.shortcode).slice(-4),
  confirmation: withoutSecret(urls.confirmationUrl),
  validation: withoutSecret(urls.validationUrl),
});
const response = await registerC2bUrls();
console.log("Safaricom C2B registration response", {
  shortcode: response.shortcode,
  version: response.version,
  responseCode: response.responseCode,
  responseDescription: response.responseDescription,
});
