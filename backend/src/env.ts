// Loads backend/.env (OIDC_*, PORT, MONGO_URI) if present. No dependency needed on Node >= 20.12.
// Its own module, imported first by main.ts: ESM evaluates imports before the importer's body,
// so calling this inside main.ts would run after app.module.ts had already read MONGO_URI.
try {
  process.loadEnvFile();
} catch {
  // no .env: fall back to the variables already in the environment
}
