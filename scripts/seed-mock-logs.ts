import '../src/utils/bootstrap';
import { saveLogEntry } from '../src/services/logManager';
import uuidv4 from '../src/utils/uuid';

const mockEntries = [
  // --- Date: 2026-09-19 (Today / Latest) ---
  {
    date: '2026-09-19',
    timestamp: '2026-09-19T08:05:12.000Z',
    appId: 'app-default-1',
    appName: 'Sample JSON Store API',
    backendName: 'JSON Placeholder API',
    routeType: 'backend' as const,
    targetUrl: 'https://jsonplaceholder.typicode.com',
    method: 'GET',
    endpoint: '/posts',
    requestHeaders: {
      accept: 'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      host: 'localhost:4000'
    },
    requestBody: '',
    statusCode: 200,
    responseHeaders: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'max-age=43200',
      'x-powered-by': 'Express'
    },
    responseBody: JSON.stringify(
      [
        { id: 1, userId: 1, title: 'Optimized date-based partitioning in proxy server', body: 'Partitioning logs by YYYY-MM-DD eliminates startup latency.' },
        { id: 2, userId: 1, title: 'Second post item', body: 'Seamlessly navigating between date folders.' }
      ],
      null,
      2
    ),
    durationMs: 34
  },
  {
    date: '2026-09-19',
    timestamp: '2026-09-19T08:08:45.000Z',
    appId: 'app-default-1',
    appName: 'Sample JSON Store API',
    backendName: 'JSON Placeholder API',
    routeType: 'backend' as const,
    targetUrl: 'https://jsonplaceholder.typicode.com',
    method: 'POST',
    endpoint: '/posts',
    requestHeaders: {
      'content-type': 'application/json',
      accept: 'application/json',
      host: 'localhost:4000'
    },
    requestBody: JSON.stringify(
      {
        title: 'New Proxy Feature Test',
        body: 'Testing mock data generation for date subfolders.',
        userId: 101
      },
      null,
      2
    ),
    statusCode: 201,
    responseHeaders: {
      'content-type': 'application/json; charset=utf-8',
      'x-powered-by': 'Express'
    },
    responseBody: JSON.stringify(
      {
        id: 101,
        title: 'New Proxy Feature Test',
        body: 'Testing mock data generation for date subfolders.',
        userId: 101,
        createdAt: '2026-09-19T08:08:45.120Z'
      },
      null,
      2
    ),
    durationMs: 78
  },
  {
    date: '2026-09-19',
    timestamp: '2026-09-19T08:10:02.000Z',
    appId: 'app-default-2',
    appName: 'Sample SOAP Calculator Service',
    backendName: 'Calculator SOAP Backend',
    routeType: 'backend' as const,
    targetUrl: 'http://www.dneonline.com',
    method: 'POST',
    endpoint: '/calculator.asmx',
    requestHeaders: {
      'content-type': 'text/xml; charset=utf-8',
      soapaction: '"http://tempuri.org/Add"',
      host: 'localhost:4000'
    },
    requestBody: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Add xmlns="http://tempuri.org/">
      <intA>42</intA>
      <intB>58</intB>
    </Add>
  </soap:Body>
</soap:Envelope>`,
    statusCode: 200,
    responseHeaders: {
      'content-type': 'text/xml; charset=utf-8',
      server: 'Microsoft-IIS/10.0'
    },
    responseBody: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <AddResponse xmlns="http://tempuri.org/">
      <AddResult>100</AddResult>
    </AddResponse>
  </soap:Body>
</soap:Envelope>`,
    durationMs: 115
  },
  {
    date: '2026-09-19',
    timestamp: '2026-09-19T08:11:30.000Z',
    appId: 'app-default-1',
    appName: 'Sample JSON Store API',
    backendName: 'JSON Placeholder API',
    routeType: 'backend' as const,
    targetUrl: 'https://jsonplaceholder.typicode.com',
    method: 'GET',
    endpoint: '/posts/9999',
    requestHeaders: {
      accept: 'application/json',
      host: 'localhost:4000'
    },
    requestBody: '',
    statusCode: 404,
    responseHeaders: {
      'content-type': 'application/json; charset=utf-8'
    },
    responseBody: JSON.stringify({ error: 'Not Found', message: 'Post 9999 does not exist' }, null, 2),
    durationMs: 42
  },

  // --- Date: 2026-09-18 (Yesterday) ---
  {
    date: '2026-09-18',
    timestamp: '2026-09-18T14:22:10.000Z',
    appId: 'app-default-1',
    appName: 'Sample JSON Store API',
    backendName: 'JSON Placeholder API',
    routeType: 'backend' as const,
    targetUrl: 'https://jsonplaceholder.typicode.com',
    method: 'GET',
    endpoint: '/posts/1',
    requestHeaders: {
      accept: 'application/json',
      host: 'localhost:4000'
    },
    requestBody: '',
    statusCode: 200,
    responseHeaders: {
      'content-type': 'application/json; charset=utf-8'
    },
    responseBody: JSON.stringify(
      {
        id: 1,
        userId: 1,
        title: 'sunt aut facere repellat provident occaecati excepturi optio reprehenderit',
        body: 'quia et suscipit suscipit recusandae consequuntur expedita et cum reprehenderit molestiae'
      },
      null,
      2
    ),
    durationMs: 28
  },
  {
    date: '2026-09-18',
    timestamp: '2026-09-18T16:45:00.000Z',
    appId: 'app-default-1',
    appName: 'Sample JSON Store API',
    backendName: 'JSON Placeholder API',
    routeType: 'backend' as const,
    targetUrl: 'https://jsonplaceholder.typicode.com',
    method: 'PUT',
    endpoint: '/posts/1',
    requestHeaders: {
      'content-type': 'application/json',
      accept: 'application/json',
      host: 'localhost:4000'
    },
    requestBody: JSON.stringify({ id: 1, title: 'Updated Title', body: 'Updated Body', userId: 1 }, null, 2),
    statusCode: 200,
    responseHeaders: {
      'content-type': 'application/json; charset=utf-8'
    },
    responseBody: JSON.stringify({ id: 1, title: 'Updated Title', body: 'Updated Body', userId: 1 }, null, 2),
    durationMs: 65
  },
  {
    date: '2026-09-18',
    timestamp: '2026-09-18T18:12:30.000Z',
    appId: 'app-default-2',
    appName: 'Sample SOAP Calculator Service',
    backendName: 'Calculator SOAP Backend',
    routeType: 'backend' as const,
    targetUrl: 'http://www.dneonline.com',
    method: 'POST',
    endpoint: '/calculator.asmx',
    requestHeaders: {
      'content-type': 'text/xml; charset=utf-8',
      soapaction: '"http://tempuri.org/Multiply"',
      host: 'localhost:4000'
    },
    requestBody: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Multiply xmlns="http://tempuri.org/">
      <intA>7</intA>
      <intB>8</intB>
    </Multiply>
  </soap:Body>
</soap:Envelope>`,
    statusCode: 200,
    responseHeaders: {
      'content-type': 'text/xml; charset=utf-8'
    },
    responseBody: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <MultiplyResponse xmlns="http://tempuri.org/">
      <MultiplyResult>56</MultiplyResult>
    </MultiplyResponse>
  </soap:Body>
</soap:Envelope>`,
    durationMs: 92
  },

  // --- Date: 2026-09-17 (Two days ago) ---
  {
    date: '2026-09-17',
    timestamp: '2026-09-17T09:15:00.000Z',
    appId: 'app-default-1',
    appName: 'Sample JSON Store API',
    backendName: 'JSON Placeholder API',
    routeType: 'backend' as const,
    targetUrl: 'https://jsonplaceholder.typicode.com',
    method: 'GET',
    endpoint: '/posts?userId=1',
    requestHeaders: {
      accept: 'application/json',
      host: 'localhost:4000'
    },
    requestBody: '',
    statusCode: 200,
    responseHeaders: {
      'content-type': 'application/json; charset=utf-8'
    },
    responseBody: JSON.stringify(
      [
        { id: 1, userId: 1, title: 'First post by user 1' },
        { id: 2, userId: 1, title: 'Second post by user 1' }
      ],
      null,
      2
    ),
    durationMs: 45
  },
  {
    date: '2026-09-17',
    timestamp: '2026-09-17T11:30:15.000Z',
    appId: 'app-default-1',
    appName: 'Sample JSON Store API',
    backendName: 'JSON Placeholder API',
    routeType: 'backend' as const,
    targetUrl: 'https://jsonplaceholder.typicode.com',
    method: 'DELETE',
    endpoint: '/posts/1',
    requestHeaders: {
      host: 'localhost:4000'
    },
    requestBody: '',
    statusCode: 200,
    responseHeaders: {
      'content-type': 'application/json; charset=utf-8'
    },
    responseBody: JSON.stringify({}, null, 2),
    durationMs: 38
  }
];

function seed() {
  console.log('Seeding mock logs into date-partitioned folders...');
  let count = 0;
  for (const item of mockEntries) {
    const id = uuidv4();
    saveLogEntry({
      id,
      ...item
    });
    console.log(`  [${item.date}] [${item.method}] ${item.endpoint} -> ${item.statusCode} (${id})`);
    count++;
  }
  console.log(`\nSuccessfully created ${count} mock log entries across 3 dates:`);
  console.log(' - 2026-09-19 (Today: 4 requests)');
  console.log(' - 2026-09-18 (Yesterday: 3 requests)');
  console.log(' - 2026-09-17 (Two days ago: 2 requests)');
}

seed();
