// api/firestore-proxy/[...path].js
const { Builder } = require('xml2js');

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const PROJECT_ID = 'fixitch-597f6';
const DATABASE = '(default)';

// Helper: "Desenvolver" los wrappers de tipo de Firestore
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

// Helper: Limpiar documento de Firestore
function cleanDocument(doc) {
  const cleaned = { id: doc.name?.split('/').pop() };
  if (doc.fields) {
    for (const [key, value] of Object.entries(doc.fields)) {
      cleaned[key] = unwrapValue(value);
    }
  }
  return cleaned;
}

// Helper: Convertir JSON limpio a XML
function jsonToXml(obj, rootName = 'firestoreResponse') {
  return new Builder({
    headless: false,
    renderOpts: { pretty: true, indent: '  ' },
    xmldec: { version: '1.0', encoding: 'UTF-8' }
  }).buildObject({ [rootName]: obj });
}

// Helper: Limpiar respuesta completa de Firestore
function cleanFirestoreResponse(jsonData) {
  let cleaned = { ...jsonData };
  
  // Si es lista de documentos
  if (cleaned.documents && Array.isArray(cleaned.documents)) {
    cleaned.documents = cleaned.documents.map(cleanDocument);
  }
  // Si es documento individual
  else if (cleaned.fields) {
    cleaned = cleanDocument(cleaned);
  }
  
  return cleaned;
}

// Handler principal
module.exports = async function handler(req, res) {
  const { method, headers, query } = req;
  const acceptHeader = headers['accept'] || 'application/json';
  const authToken = headers['authorization'];

  // Validar autenticación
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  // Construir ruta dinámica desde query.path (catch-all de Vercel)
  let dynamicPath = '';
  if (Array.isArray(query.path) && query.path.length > 0) {
    dynamicPath = `/${query.path.join('/')}`;
  }
  // Fallback: extraer de req.url si query.path no está disponible
  else if (req.url) {
    dynamicPath = req.url.replace(/^\/api\/firestore-proxy/, '');
    if (dynamicPath && !dynamicPath.startsWith('/')) {
      dynamicPath = '/' + dynamicPath;
    }
  }

  // Construir URL de Firestore
  const firestoreUrl = `${FIRESTORE_BASE}/projects/${PROJECT_ID}/databases/${DATABASE}/documents${dynamicPath}`;

  try {
    // Preparar headers para Firestore
    const firestoreHeaders = {
      'Authorization': authToken,
      'Content-Type': 'application/json'
    };

    // Preparar body para métodos que lo requieren
    const fetchOptions = {
      method: method,
      headers: firestoreHeaders,
    };

    // Agregar body solo para POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    // Llamar a Firestore
    const firestoreResponse = await fetch(firestoreUrl, fetchOptions);
    const statusCode = firestoreResponse.status;
    
    // Leer respuesta como texto primero para manejar errores
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

    // Determinar formato de salida
    const wantsXml = acceptHeader.includes('xml');

    if (wantsXml) {
      // Limpiar datos y convertir a XML
      const cleanedData = cleanFirestoreResponse(firestoreData);
      const xmlOutput = jsonToXml(cleanedData, 'firestoreResponse');
      
      return res
        .status(statusCode)
        .setHeader('Content-Type', 'application/xml; charset=utf-8')
        .send(xmlOutput);
    } else {
      // Devolver JSON limpio
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
