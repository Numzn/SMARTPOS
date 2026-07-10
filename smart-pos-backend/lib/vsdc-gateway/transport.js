const axios = require('axios');
const vsdcService = require('../../services/vsdcService');
const endpointAdapter = require('./endpointAdapter');

function baseUrl() {
  const root = process.env.VSDC_URL || vsdcService.baseURL || 'http://localhost:8090';
  const basePath = process.env.VSDC_BASE_PATH || '';
  if (!basePath) return root.replace(/\/$/, '');
  return `${root.replace(/\/$/, '')}/${basePath.replace(/^\//, '')}`;
}

/**
 * POST JSON to VSDC (mock or official path).
 */
async function post(path, body, { useAuth = true } = {}) {
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'SmartPOS-Zambia/1.0',
    'X-Request-ID': vsdcService.generateRequestId?.() || `REQ_${Date.now()}`,
  };

  if (useAuth && vsdcService.sessionToken) {
    headers.Authorization = `Bearer ${vsdcService.sessionToken}`;
    if (vsdcService.sessionId) headers['X-Session-ID'] = vsdcService.sessionId;
  }

  const response = await axios.post(url, body, { headers, timeout: 60000 });
  const data = response.data;
  const success = data?.resultCd === '000' || data?.status === 'SUCCESS';
  return { success, data, status: response.status };
}

/**
 * Ensure session then POST.
 */
async function authenticatedPost(path, body) {
  if (!vsdcService.sessionToken) {
    const auth = await vsdcService.authenticate();
    if (!auth.success) {
      throw new Error(auth.error || 'VSDC authentication failed');
    }
  }
  return post(path, body, { useAuth: true });
}

module.exports = {
  baseUrl,
  post,
  authenticatedPost,
};
