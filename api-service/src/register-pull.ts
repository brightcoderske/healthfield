import { buildPaymentRecoveryCallbackUrls, pullTransactionsConfiguration, registerPullTransactionsCallback } from "./mpesa";

const config = pullTransactionsConfiguration();
if (!config?.nominatedNumber) {
  console.error("Pull Transactions setup is incomplete. Set MPESA_PULL_ENABLED=true and MPESA_PULL_NOMINATED_NUMBER in the API environment.");
  process.exit(1);
}

const callback = buildPaymentRecoveryCallbackUrls(config.callbackBaseUrl, config.callbackSecret).pullNotificationUrl;
console.log("Registering the Healthfield Pull Transactions callback", { shortcodeSuffix: config.shortcode.slice(-4), nominatedNumberSuffix: config.nominatedNumber.slice(-3), callback: callback.replace(/\/[^/]+$/, "/[redacted]") });
const response = await registerPullTransactionsCallback();
console.log("Safaricom Pull Transactions registration response", {
  responseCode: String(response.ResponseCode ?? ""),
  responseStatus: String(response.ResponseStatus ?? ""),
  responseDescription: String(response.ResponseDescription ?? ""),
  responseRefId: String(response.ResponseRefID ?? ""),
});
