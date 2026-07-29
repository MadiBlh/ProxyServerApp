const logManager = require('./logManager');

async function replayRequest({ logId, customUrl, customMethod, customHeaders, customBody }) {
  const detail = logManager.getLogDetail(logId);

  let url = customUrl || (detail ? detail.reqMeta.targetUrl + (detail.reqMeta.endpoint || '') : null);
  let method = customMethod || (detail ? detail.reqMeta.method : 'POST');
  let headers = customHeaders || (detail ? detail.reqMeta.headers : {});
  let body = customBody !== undefined ? customBody : (detail ? detail.requestBody : '');

  if (!url) {
    throw new Error('No target URL available for replay');
  }

  // Clean up system headers that cause fetch errors
  const cleanHeaders = { ...headers };
  delete cleanHeaders['host'];
  delete cleanHeaders['content-length'];
  delete cleanHeaders['connection'];
  delete cleanHeaders['accept-encoding'];

  const startTime = Date.now();

  const options = {
    method: method.toUpperCase(),
    headers: cleanHeaders
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method) && body) {
    options.body = body;
  }

  try {
    const response = await fetch(url, options);
    const durationMs = Date.now() - startTime;

    const resHeaders = {};
    response.headers.forEach((val, key) => {
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
      error: error.message,
      body: `Replay Execution Failed: ${error.message}`
    };
  }
}

module.exports = {
  replayRequest
};
