const http = require('http');
const { URL } = require('url');
const POEM_CORPUS = require('./data/poem-corpus.json');

const PORT = Number(process.env.PORT || 3000);
const IP_LOOKUP_BASE_URL = 'https://whois.pconline.com.cn/ipJson.jsp';
const IP_LOOKUP_TIMEOUT_MS = Number(process.env.IP_LOOKUP_TIMEOUT_MS || 5000);

const FALLBACK_POEMS = [
  '海内存知己，天涯若比邻。',
  '但愿人长久，千里共婵娟。',
  '行到水穷处，坐看云起时。'
];
const FALLBACK_POEM = FALLBACK_POEMS[0];

function uniqueItems(items) {
  return [...new Set(items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function cleanDivisionName(value) {
  return String(value || '')
    .replace(/特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市|地区|盟|自治州|区|县|自治县|旗|自治旗$/g, '')
    .trim();
}

function getCorpusItems(ipInfo) {
  // 匹配顺序为：region -> city  -> province
  // 如果某个 key 存在但数组为空，继续向上级回退，避免返回空库导致只能走通用兜底
  const directNames = uniqueItems([
    cleanDivisionName(ipInfo.region),
    cleanPart(ipInfo.region),
    cleanDivisionName(ipInfo.city),
    cleanPart(ipInfo.city),
    cleanDivisionName(ipInfo.pro),
    cleanPart(ipInfo.pro)
  ]);

  for (const name of directNames) {
    const items = POEM_CORPUS[name];
    if (Array.isArray(items) && items.length > 0) return items;
  }

  const candidates = [...directNames, ipInfo.addr].filter(Boolean).join(' ');

  const matchedName = Object.keys(POEM_CORPUS)
    .sort((a, b) => b.length - a.length)
    .find((name) => candidates.includes(name));

  return matchedName && Array.isArray(POEM_CORPUS[matchedName]) ? POEM_CORPUS[matchedName] : [];
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

function normalizeIp(ip) {
  if (!ip) return '';
  const firstIp = String(ip).split(',')[0].trim();
  return firstIp.replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
}

function getForwardedHeaderIp(forwarded = '') {
  const match = String(forwarded).match(/(?:^|[,;\s])for=("?)(\[?[a-f\d:.]+\]?|[^;,\s"]+)\1/i);
  return normalizeIp(match?.[2] || '');
}

function getClientIp(req) {
  const headers = req.headers || {};
  return (
    normalizeIp(headers['x-forwarded-for']) ||
    normalizeIp(headers['x-real-ip']) ||
    getForwardedHeaderIp(headers.forwarded) ||
    normalizeIp(req.socket?.remoteAddress) ||
    ''
  );
}

function isLocalIp(ip) {
  return (
    !ip ||
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip === 'localhost' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function cleanPart(value) {
  return String(value || '')
    .replace(/省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区/g, '')
    .trim();
}

function normalizeIsp(isp = '') {
  const text = String(isp);
  if (/电信|China Telecom|Chinanet|CN2/i.test(text)) return '电信';
  if (/联通|Unicom|China169/i.test(text)) return '联通';
  if (/移动|Mobile|CMCC|CMNET/i.test(text)) return '移动';
  if (/广电|CBN/i.test(text)) return '广电';
  if (/铁通|Tietong/i.test(text)) return '铁通';
  if (/教育网|CERNET/i.test(text)) return '教育网';
  return text.trim();
}

function extractPconlineIsp(ipInfo) {
  const addr = String(ipInfo.addr || '').trim();
  if (!addr) return '';

  const locationNames = [ipInfo.pro, ipInfo.city, ipInfo.region]
    .filter(Boolean)
    .map((name) => String(name).trim());

  let isp = addr;
  for (const name of locationNames) {
    isp = isp.replace(name, '');
  }
  return normalizeIsp(isp.trim());
}

function buildLocation(ipInfo) {
  const country = ipInfo.pro || ipInfo.city || ipInfo.region ? '中国' : '';
  const parts = [country, cleanPart(ipInfo.pro), cleanPart(ipInfo.city), extractPconlineIsp(ipInfo)].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' ');
  }

  return String(ipInfo.addr || '').trim();
}

function pickPoem(ipInfo) {
  const directItems = uniqueItems(getCorpusItems(ipInfo));
  if (directItems.length > 0) return pickRandom(directItems);

  return pickRandom(FALLBACK_POEMS);
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function parsePconlineJson(text) {
  const jsonText = String(text || '')
    .trim()
    .replace(/^if\s*\(\s*window\.[\w$]+\s*\)\s*\{?\s*[\w$]+\(/, '')
    .replace(/\);?\s*\}?\s*$/, '');

  return JSON.parse(jsonText);
}

function normalizePconlinePayload(value) {
  if (!value) return null;
  if (typeof value === 'string') return parsePconlineJson(value);
  if (typeof value === 'object') return value;
  return null;
}

function hasClientLocationParams(searchParams) {
  return ['pro', 'city', 'region', 'addr', 'proCode', 'cityCode', 'regionCode'].some((key) =>
    searchParams.has(key)
  );
}

function getClientLocationFromQuery(searchParams) {
  return {
    ip: normalizeIp(searchParams.get('ip')),
    pro: searchParams.get('pro') || '',
    proCode: searchParams.get('proCode') || '',
    city: searchParams.get('city') || '',
    cityCode: searchParams.get('cityCode') || '',
    region: searchParams.get('region') || '',
    regionCode: searchParams.get('regionCode') || '',
    addr: searchParams.get('addr') || '',
    regionNames: searchParams.get('regionNames') || '',
    err: searchParams.get('err') || ''
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function buildPoemResponse(ipInfo) {
  return {
    poem: pickPoem(ipInfo),
    location: buildLocation(ipInfo)
  };
}

async function queryIpLocation(ip) {
  const normalizedIp = normalizeIp(ip);
  const url = new URL(IP_LOOKUP_BASE_URL);
  url.searchParams.set('ip', isLocalIp(normalizedIp) ? '' : normalizedIp);
  url.searchParams.set('json', 'true');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IP_LOOKUP_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'location-poems-api/1.0' },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`pconline HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const text = new TextDecoder('gb18030').decode(buffer);
  const data = parsePconlineJson(text);

  if (!data || typeof data !== 'object') {
    throw new Error('pconline 查询失败');
  }
  return data;
}

async function handlePoemRequest(req, res, url) {
  const requestedIp = normalizeIp(url.searchParams.get('ip'));
  const clientIp = getClientIp(req);
  const ip = requestedIp || clientIp;

  try {
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const ipInfo = normalizePconlinePayload(body.ipInfo || body.pconline || body);
      if (!ipInfo || typeof ipInfo !== 'object') {
        return sendJson(res, 400, {
          poem: FALLBACK_POEM,
          location: '',
          error: '请传入前端从 pconline 获取到的 JSON 数据'
        });
      }
      return sendJson(res, 200, buildPoemResponse(ipInfo));
    }

    if (hasClientLocationParams(url.searchParams)) {
      return sendJson(res, 200, buildPoemResponse(getClientLocationFromQuery(url.searchParams)));
    }

    const ipInfo = await queryIpLocation(ip);
    return sendJson(res, 200, buildPoemResponse(ipInfo));
  } catch (error) {
    sendJson(res, 502, {
      poem: FALLBACK_POEM,
      location: '',
      error: error.message
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  if (url.pathname === '/' || url.pathname === '/poem') {
    return handlePoemRequest(req, res, url);
  }

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, {
    error: 'Not Found',
    usage: 'GET /poem?ip=8.8.8.8 或直接访问 /poem 使用访问者 IP'
  });
});

server.listen(PORT, () => {
  console.log(`Location poem API listening on http://localhost:${PORT}`);
});
