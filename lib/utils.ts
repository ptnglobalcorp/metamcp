import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type DbQuery<T> = () => Promise<T>;

interface RetryOptions {
  retries?: number;
  delayMs?: number;
}

export async function retryDbQuery<T>(
  query: DbQuery<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { retries = 10, delayMs = 500 } = options;
  let attempt = 0;
  while (true) {
    try {
      return await query();
    } catch (err) {
      if (attempt >= retries) throw err;
      attempt++;
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
}
