// api/firestore-proxy/[...path].js
const { Builder } = require('xml2js');

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const PROJECT_ID = 'fixitch-597f6';
const DATABASE = '(default)';

// ===== HELPERS PARA XML =====
function unwrapValue(field) {
  if (!field) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return parseInt(field.integerValue);
  if (field.arrayValue?.values) {
    return field.arrayValue.values.map(v => unwrapValue(v));
  }
  if (field.timestampValue) return field.timestampValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.nullValue !== undefined) return null;
  if (typeof field === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(field)) {
      cleaned[k] = unwrapValue(v);
    }
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
  const builder = new Builder({
    headless: false,
    renderOpts: { pretty: true, indent: '  ' },
    xmldec: { version: '1.0', encoding: 'UTF-8' }
  });
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

// ===== FUNCIÓN PRINCIPAL =====
module.exports = async function handler(req, res) {
  const { method, headers } = req;

  // 1. Responder a preflight OPTIONS (CORS)
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Accept');
    return res.status(204).end();
  }

  // 2. Validar token (solo para otros métodos)
  const authToken = headers.authorization;
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required (Bearer token)' });
  }

  // 3. Construir la URL de Firestore respetando path dinámico y query string
  //    req.url = "/api/firestore-proxy/requests?orderBy=createdAt"
  //    pathWithQuery = "/requests?orderBy=createdAt"
  const pathWithQuery = (req.url || '').replace(/^\/api\/firestore-proxy/, '');
  const firestoreUrl = `${FIRESTORE_BASE}/projects/${PROJECT_ID}/databases/${DATABASE}/documents${pathWithQuery}`;

  console.log('➡️ Proxy request:', { method, firestoreUrl });

  // 4. Leer el cuerpo de la petición original (importante para POST, PATCH, etc.)
  let body = null;
  const contentType = headers['content-type'] || '';

  if (method !== 'GET' && method !== 'HEAD') {
    // Para métodos con cuerpo, extraemos el raw body
    body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data || null));
      req.on('error', reject);
    });
    
    // Si el cliente envió JSON y el body no está vacío, lo parseamos (opcional, para validar)
    if (contentType.includes('application/json') && body) {
      try {
        // Solo validamos, luego reenviamos el mismo string
        JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
  }

  // 5. Hacer la petición a Firestore
  const fetchOptions = {
    method: method,
    headers: {
      'Authorization': authToken,
      'Content-Type': contentType || 'application/json',  // importante respetar el tipo
    },
    // Solo añadir body si existe y no es GET/HEAD
    ...(body && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
    signal: AbortSignal.timeout(15000)
  };

  try {
    const firestoreResponse = await fetch(firestoreUrl, fetchOptions);
    const responseText = await firestoreResponse.text();

    // Si Firestore devuelve HTML (error de autenticación/ruta)
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      return res.status(502).json({
        error: 'Firestore returned HTML error page',
        firestoreStatus: firestoreResponse.status,
        firestoreUrl,
        hint: 'Verifica que el token tenga acceso y que la colección exista'
      });
    }

    // Intentar parsear como JSON
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

    // 6. Decidir formato de salida (JSON o XML)
    const acceptHeader = headers.accept || 'application/json';
    const wantsXml = acceptHeader.includes('xml');

    if (wantsXml) {
      const cleaned = cleanFirestoreResponse(firestoreData);
      const xmlOutput = jsonToXml(cleaned, 'firestoreResponse');
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(firestoreResponse.status).send(xmlOutput);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
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
