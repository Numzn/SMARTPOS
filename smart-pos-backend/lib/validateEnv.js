/**
 * Fail-fast startup checks. A missing DATABASE_URL or a weak/placeholder
 * JWT_SECRET should crash the process immediately with a clear message,
 * not surface later as a confusing 500 on the first authenticated request
 * (or worse, silently sign tokens with a secret published in this repo).
 */

const KNOWN_WEAK_SECRETS = new Set([
  'change-me-in-production',
  'changeme',
  'secret',
  'password',
  'ci-test-secret',
]);

function assertRequiredEnv(env = process.env) {
  const problems = [];

  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set.');
  }

  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    problems.push('JWT_SECRET is not set.');
  } else if (KNOWN_WEAK_SECRETS.has(jwtSecret.trim().toLowerCase())) {
    problems.push(
      `JWT_SECRET is set to a known placeholder value ("${jwtSecret}"). Set a real, random secret.`
    );
  } else if (jwtSecret.length < 32) {
    problems.push(
      `JWT_SECRET is only ${jwtSecret.length} characters — use at least 32 random characters.`
    );
  }

  if (problems.length > 0) {
    console.error('\n[startup] Refusing to start — configuration problem(s) found:\n');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    console.error('\nSee .env.docker.example for the required variables.\n');
    process.exit(1);
  }
}

module.exports = { assertRequiredEnv, KNOWN_WEAK_SECRETS };
