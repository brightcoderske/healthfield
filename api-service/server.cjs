import("./dist/server.mjs").catch((error) => {
  console.error("Healthfield API could not start.", error);
  process.exitCode = 1;
});
