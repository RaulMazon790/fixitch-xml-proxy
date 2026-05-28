// api/firestore-proxy/index.js
const { Builder } = require('xml2js');

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const PROJECT_ID = 'fixitch-597f6';
const DATABASE = '(default)';

// ===== Conversión XML =====
function unwrapValue(field) {
  if (!field) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return parseInt(field.integerValue);
  if (field.arrayValue?.values) return field.arrayValue.values.map(v => unwrapValue(v));
  if (field.timestampValue) return field.timestampValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.nullValue !== undefined) return null;
  if (typeof field === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(field)) cleaned[k] = unwrapValue(v);
    return cleaned;
  }
  return field;
}

function cleanDocument(doc) {
  const cleaned = { id: doc.name?.split('/').pop() };
  if (doc.fields) {
    for (const [key, value] of Object.entries(doc.fields)) {
      cleaned[key] = unwrapValue(value);
    }
  }
  return cleaned;
}

function jsonToXml(obj, rootName = 'firestoreResponse') {
  const builder = new Builder({ headless: false, renderOpts: { pretty: true, indent: '  ' }, xmldec: { version: '1.0', encoding: 'UTF-8' } });
  return builder.buildObject({ [rootName]: obj });
}

function cleanFirestoreResponse(jsonData) {
  let cleaned = { ...jsonData };
  if (cleaned.documents && Array.isArray(cleaned.documents)) {
    cleaned.documents = cleaned.documents.map(cleanDocument);
  } else if (cleaned.fields) {
    cleaned = cleanDocument(cleaned);
  }
  return cleaned;
}

// ===== Función principal =====
module.exports = async function handler(req, res) {
  const { method, headers } = req;

  // 1. CORS preflight
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Accept');
    return res.status(204).end();
  }

  // 2. Validar token
  const authToken = headers.authorization;
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required (Bearer token)' });
  }

  // 3. Extraer la ruta de Firestore desde la URL original (sin el prefijo /firestore)
  //    Ejemplo: req.url = "/firestore/requests?orderBy=createdAt"
  //    firestorePath = "/requests?orderBy=createdAt"
  const originalUrl = req.url;
  const firestorePath = originalUrl.replace(/^\/firestore/, '');
  const firestoreUrl = `${FIRESTORE_BASE}/projects/${PROJECT_ID}/databases/${DATABASE}/documents${firestorePath}`;

  console.log(`➡️ ${method} ${firestoreUrl}`);

  // 4. Leer el body (si existe) para métodos POST, PUT, PATCH
  let body = null;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data || null));
      req.on('error', reject);
    });
    // Si hay body y es JSON, lo validamos (opcional)
    if (body && headers['content-type']?.includes('application/json')) {
      try { JSON.parse(body); } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
  }

  // 5. Llamar a Firestore
  const fetchOptions = {
    method,
    headers: {
      'Authorization': authToken,
      'Content-Type': headers['content-type'] || 'application/json',
    },
    signal: AbortSignal.timeout(15000)
  };
  if (body && method !== 'GET' && method !== 'HEAD') fetchOptions.body = body;

  try {
    const firestoreResponse = await fetch(firestoreUrl, fetchOptions);
    const responseText = await firestoreResponse.text();

    // Detectar HTML de error (Firestore a veces devuelve HTML cuando el token es inválido)
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      return res.status(502).json({
        error: 'Firestore returned HTML error page',
        firestoreStatus: firestoreResponse.status,
        firestoreUrl,
        hint: 'Verifica que el token tenga acceso y que la colección exista'
      });
    }

    // Parsear JSON
    let firestoreData;
    try {
      firestoreData = JSON.parse(responseText);
    } catch (parseError) {
      return res.status(502).json({
        error: 'Failed to parse Firestore response',
        rawBody: responseText.substring(0, 300),
        parseError: parseError.message
      });
    }

    // 6. Decidir formato de respuesta (JSON o XML)
    const acceptHeader = headers.accept || 'application/json';
    const wantsXml = acceptHeader.includes('xml');

    res.setHeader('Access-Control-Allow-Origin', '*');
    if (wantsXml) {
      const cleaned = cleanFirestoreResponse(firestoreData);
      const xmlOutput = jsonToXml(cleaned, 'firestoreResponse');
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.status(firestoreResponse.status).send(xmlOutput);
    } else {
      res.setHeader('Content-Type', 'application/json');
      return res.status(firestoreResponse.status).json(firestoreData);
    }
  } catch (error) {
    console.error('❌ Proxy error:', error);
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      return res.status(504).json({ error: 'Timeout connecting to Firestore' });
    }
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
