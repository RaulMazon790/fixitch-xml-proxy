// api/firestore-proxy/[...path].js - VERSIÓN FINAL DEFINITIVA
const { Builder } = require('xml2js');

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const PROJECT_ID = 'fixitch-597f6';
const DATABASE = '(default)';

// ===== HELPERS PARA CONVERSIÓN XML =====
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
  return new Builder({
    headless: false,
    renderOpts: { pretty: true, indent: '  ' },
    xmldec: { version: '1.0', encoding: 'UTF-8' }
  }).buildObject({ [rootName]: obj });
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

// ===== HANDLER PRINCIPAL =====
module.exports = async function handler(req, res) {
  const { method, headers } = req;
  const acceptHeader = headers['accept'] || 'application/json';
  const authToken = headers['authorization'];

  // Validar autenticación
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  // 🔑 EXTRAER RUTA: Parsear req.url directamente (NO usar query.path)
  // req.url ejemplo: "/api/firestore-proxy/requests/ABC123?updateMask.fieldPaths=estado"
  const fullUrl = req.url || '';
  const [rawPath, queryString] = fullUrl.split('?');
  
  // Remover prefijo de Vercel para obtener ruta relativa a Firestore
  // Resultado: "/requests/ABC123"
  const firestorePath = rawPath.replace(/^\/api\/firestore-proxy/, '');
  
  // Reconstruir query string si existe
  const queryParams = queryString ? `?${queryString}` : '';
  
  // URL final de Firestore
  const firestoreUrl = `${FIRESTORE_BASE}/projects/${PROJECT_ID}/databases/${DATABASE}/documents${firestorePath}${queryParams}`;

  // Debug en logs (opcional, útil para verificar)
  console.log('🔗 Firestore URL:', firestoreUrl);

  try {
    const firestoreHeaders = {
      'Authorization': authToken,
      'Content-Type': 'application/json'
    };

    const fetchOptions = {
      method: method,
      headers: firestoreHeaders,
    };

    // Agregar body solo para POST/PUT/PATCH
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

    // ===== CONVERSIÓN JSON → XML (si se solicita) =====
    const wantsXml = acceptHeader.includes('xml');

    if (wantsXml) {
      const cleanedData = cleanFirestoreResponse(firestoreData);
      const xmlOutput = jsonToXml(cleanedData, 'firestoreResponse');
      return res
        .status(statusCode)
        .setHeader('Content-Type', 'application/xml; charset=utf-8')
        .send(xmlOutput);
    } else {
      const cleanedData = cleanFirestoreResponse(firestoreData);
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
  }
};
