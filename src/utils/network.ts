import { setTimeout as sleep } from "node:timers/promises";
import { NetworkError } from "./errors";

interface RetryConfig {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

export const fetchWithRetry = async (
  url: string,
  options: RequestInit = {},
  retryConfig: RetryConfig = DEFAULT_RETRY,
  attempt = 0,
): Promise<Response> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 429) {
      throw new NetworkError("Rate limited", 429);
    }
    if (response.status >= 500) {
      throw new NetworkError(`Server error: ${response.status}`, response.status);
    }

    return response;
  } catch (err) {
    if (attempt >= retryConfig.maxRetries) {
      throw new NetworkError(
        `Failed after ${retryConfig.maxRetries} retries: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const delay = Math.min(
      retryConfig.baseDelayMs * 2 ** attempt + Math.random() * 1000,
      retryConfig.maxDelayMs,
    );
    await sleep(delay);
    return fetchWithRetry(url, options, retryConfig, attempt + 1);
  }
};
