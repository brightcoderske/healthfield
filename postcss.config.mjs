const config = {
  // Healthfield uses authored CSS only. Keeping PostCSS worker-free avoids
  // CloudLinux process-limit failures during production builds.
  plugins: {},
};

export default config;
