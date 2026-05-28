// api/firestore-proxy/[...path].js
const { Builder } = require('xml2js');

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const PROJECT_ID = 'fixitch-597f6';
const DATABASE = '(default)';

// === HELPERS PARA LIMPIEZA DE DATOS ===
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

function cleanFirestoreResponse(jsonData) {
  let cleaned = { ...jsonData };
  if (cleaned.documents && Array.isArray(cleaned.documents)) {
    cleaned.documents = cleaned.documents.map(cleanDocument);
  } else if (cleaned.fields) {
    cleaned = cleanDocument(cleaned);
  }
  return cleaned;
}

// === HELPER PARA CONVERTIR JSON → XML ===
function jsonToXml(obj, rootName = 'firestoreResponse') {
  return new Builder({
    headless: false,
    renderOpts: { pretty: true, indent: '  ' },
    xmldec: { version: '1.0', encoding: 'UTF-8' }
  }).buildObject({ [rootName]: obj });
}

// === HANDLER PRINCIPAL ===
module.exports = async function handler(req, res) {
  const { method, headers, query } = req;
  const acceptHeader = headers['accept'] || 'application/json';
  const authToken = headers['authorization'];

  // Validar autenticación
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  // Extraer ruta: query.path de Vercel catch-all
  // Ej: /api/firestore-proxy/requests/ID → query.path = ['requests', 'ID']
  const pathSegments = Array.isArray(query.path) ? query.path : [];
  const firestorePath = pathSegments.length > 0 ? '/' + pathSegments.join('/') : '';

  // Extraer query string desde req.url
  // Ej: req.url = "/api/firestore-proxy/requests/ID?updateMask.fieldPaths=estado"
  const urlParts = (req.url || '').split('?');
  const queryString = urlParts.length > 1 ? '?' + urlParts[1] : '';

  // Construir URL de Firestore
  const firestoreUrl = `${FIRESTORE_BASE}/projects/${PROJECT_ID}/databases/${DATABASE}/documents${firestorePath}${queryString}`;

  try {
    const firestoreHeaders = {
      'Authorization': authToken,
      'Content-Type': 'application/json'
    };

    const fetchOptions = {
      method: method,
      headers: firestoreHeaders,
    };

    if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const firestoreResponse = await fetch(firestoreUrl, fetchOptions);
    const statusCode = firestoreResponse.status;
    const responseText = await firestoreResponse.text();

    // Verificar si es HTML de error
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      return res.status(502).json({
        error: 'Firestore returned HTML error',
        status: statusCode,
        url: firestoreUrl
      });
    }

    // Parsear JSON
    let firestoreData;
    try {
      firestoreData = responseText ? JSON.parse(responseText) : {};
    } catch (parseError) {
      return res.status(502).json({
        error: 'Failed to parse Firestore response',
        raw: responseText.substring(0, 200)
      });
    }

    // === DETERMINAR FORMATO DE SALIDA: JSON o XML ===
    const wantsXml = acceptHeader.includes('xml');
    const cleanedData = cleanFirestoreResponse(firestoreData);

    if (wantsXml) {
      // Convertir a XML
      const xmlOutput = jsonToXml(cleanedData, 'firestoreResponse');
      return res
        .status(statusCode)
        .setHeader('Content-Type', 'application/xml; charset=utf-8')
        .send(xmlOutput);
    } else {
      // Devolver JSON limpio
      return res
        .status(statusCode)
        .setHeader('Content-Type', 'application/json')
        .json(cleanedData);
    }

  } catch (error) {
    console.error('❌ Proxy error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
};
