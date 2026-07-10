async function withRetry(fn, { maxRetries = 3, baseDelayMs = 1000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const retryable =
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        /timeout/i.test(err.message) ||
        err.response?.status >= 500;
      if (!retryable || attempt === maxRetries) break;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

module.exports = { withRetry };
