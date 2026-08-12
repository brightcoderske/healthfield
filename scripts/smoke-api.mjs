import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = "4311";
const apiKey = "local-smoke-api-key-at-least-32-characters";
const paymentEndpointSecret = "local-payment-endpoint-secret-at-least-32-characters";
const child = spawn(process.execPath, [resolve(root, "api-service", "dist", "server.mjs")], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    RUN_MIGRATIONS: "false",
    DATABASE_URL: "mysql://unused:unused@127.0.0.1:9/unused",
    AUTH_SECRET: "local-smoke-auth-secret-at-least-32-characters",
    API_SHARED_SECRET: apiKey,
    CORS_ALLOWED_ORIGINS: "https://healthfieldpharmacy.co.ke",
    MPESA_CONSUMER_KEY: "local-smoke-consumer-key",
    MPESA_CONSUMER_SECRET: "local-smoke-consumer-secret",
    MPESA_SHORTCODE: "174379",
    MPESA_PASSKEY: "local-smoke-passkey",
    MPESA_TRANSACTION_TYPE: "CustomerPayBillOnline",
    MPESA_CALLBACK_BASE_URL: "https://api.healthfieldpharmacy.co.ke",
    MPESA_CALLBACK_SECRET: paymentEndpointSecret,
    PORT: port,
  },
});

let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
try {
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("API startup timed out.")), 8000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Healthfield API listening")) { clearTimeout(timeout); resolveReady(); }
    });
    child.once("exit", (code) => reject(new Error(`API exited during startup (${code}). ${stderr}`)));
  });
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  const noKey = await fetch(`http://127.0.0.1:${port}/v1/views/home`);
  const badOrigin = await fetch(`http://127.0.0.1:${port}/v1/views/home`, { headers: { "X-Healthfield-Key": apiKey, Origin: "https://evil.example" } });
  const unsignedUpload = await fetch(`http://127.0.0.1:${port}/v1/prescriptions`, {
    method: "POST",
    headers: { Origin: "https://healthfieldpharmacy.co.ke" },
    body: new FormData(),
  });
  const preflight = await fetch(`http://127.0.0.1:${port}/v1/prescriptions`, {
    method: "OPTIONS",
    headers: { Origin: "https://healthfieldpharmacy.co.ke", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
  });
  const forgotPassword = await fetch(`http://127.0.0.1:${port}/v1/auth/forgot-password`, { method:"POST",headers:{"X-Healthfield-Key":apiKey,"Content-Type":"application/json"},body:JSON.stringify({email:"invalid"}) });
  const paymentBase = `http://127.0.0.1:${port}/v1/payments/mobile-money`;
  const invalidPaymentNotification = await fetch(`${paymentBase}/stk/notification/not-a-valid-secret`, { method:"POST",headers:{"Content-Type":"application/json"},body:"{}" });
  const stkNotification = await fetch(`${paymentBase}/stk/notification/${paymentEndpointSecret}`);
  const c2bConfirmation = await fetch(`${paymentBase}/c2b/confirmation/${paymentEndpointSecret}`);
  const c2bVerification = await fetch(`${paymentBase}/c2b/verification/${paymentEndpointSecret}`);
  if (health.status !== 200 || noKey.status !== 401 || badOrigin.status !== 403 || unsignedUpload.status !== 401 || preflight.status !== 204 || forgotPassword.status !== 400 || invalidPaymentNotification.status !== 404 || stkNotification.status !== 405 || c2bConfirmation.status !== 405 || c2bVerification.status !== 405) {
    throw new Error(`Unexpected statuses: ${health.status}/${noKey.status}/${badOrigin.status}/${unsignedUpload.status}/${preflight.status}/${forgotPassword.status}/${invalidPaymentNotification.status}/${stkNotification.status}/${c2bConfirmation.status}/${c2bVerification.status}`);
  }
  console.log(`API smoke test passed: health=${health.status}, no-key=${noKey.status}, CORS=${badOrigin.status}, unsigned-upload=${unsignedUpload.status}, preflight=${preflight.status}, forgot-password=${forgotPassword.status}, invalid-payment-notification=${invalidPaymentNotification.status}, STK-notification=${stkNotification.status}, C2B-confirmation=${c2bConfirmation.status}, C2B-verification=${c2bVerification.status}`);
} finally {
  child.kill("SIGTERM");
}
