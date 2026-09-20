import * as logManager from './logManager';
import type { ReplayOptions, ReplayResult } from '../types';

export async function replayRequest({
  logId,
  customUrl,
  customMethod,
  customHeaders,
  customBody
}: ReplayOptions): Promise<ReplayResult> {
  const detail = logManager.getLogDetail(logId);

  const url =
    customUrl ||
    (detail ? detail.reqMeta.targetUrl + (detail.reqMeta.endpoint || '') : null);
  const method =
    customMethod || (detail ? detail.reqMeta.method : 'POST');
  const headers: Record<string, string | string[] | undefined> =
    customHeaders || (detail ? (detail.reqMeta.headers as Record<string, string | string[] | undefined>) : {});
  const body =
    customBody !== undefined ? customBody : detail ? detail.requestBody : '';

  if (!url) {
    throw new Error('No target URL available for replay');
  }

  // Clean up system headers that cause fetch errors
  const cleanHeaders: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    const lk = key.toLowerCase();
    if (
      lk === 'host' ||
      lk === 'content-length' ||
      lk === 'connection' ||
      lk === 'accept-encoding'
    ) {
      continue;
    }
    if (val !== undefined) {
      cleanHeaders[key] = Array.isArray(val) ? val.join(', ') : val;
    }
  }

  const startTime = Date.now();

  const options: RequestInit = {
    method: method.toUpperCase(),
    headers: cleanHeaders
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method as string) && body) {
    options.body = body;
  }

  try {
    const response = await fetch(url, options);
    const durationMs = Date.now() - startTime;

    const resHeaders: Record<string, string> = {};
    response.headers.forEach((val: string, key: string) => {
      resHeaders[key] = val;
    });

    const resText = await response.text();

    return {
      success: true,
      statusCode: response.status,
      statusText: response.statusText,
      durationMs,
      headers: resHeaders,
      body: resText
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      statusCode: 500,
      statusText: 'Error',
      durationMs,
      error: (error as Error).message,
      body: `Replay Execution Failed: ${(error as Error).message}`
    };
  }
}
