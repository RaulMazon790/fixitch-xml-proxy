// api/firestore-proxy/[...path].js - TU CÓDIGO FUNCIONAL + XML
const { Builder } = require('xml2js');

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const PROJECT_ID = 'fixitch-597f6';
const DATABASE = '(default)';

// ===== HELPERS PARA CONVERSIÓN XML (NUEVOS) =====
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

// ===== TU CÓDIGO ORIGINAL (CON MINIMOS CAMBIOS) =====
module.exports = async function handler(req, res) {
  const { method, headers, query } = req;
  
  // === DEBUG: Log de entrada ===
  console.log('📥 Request received:', {
    method,
    url: req.url,
    query: query,
    headers: {
      authorization: headers['authorization'] ? 'Bearer ***' : 'MISSING',
      accept: headers['accept']
    }
  });

  const acceptHeader = headers['accept'] || 'application/json';
  const authToken = headers['authorization'];

  // Validar token
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Authorization header required',
      received: authToken ? 'Present but invalid format' : 'Missing'
    });
  }

  // === RUTA DINÁMICA SIMPLE (extraer de req.url) ===
  // req.url = "/api/firestore-proxy/requests?foo=bar"
  // Resultado: "/requests?foo=bar"
  const pathWithQuery = (req.url || '').replace(/^\/api\/firestore-proxy/, '');
  
  // Construir URL de Firestore
  const firestoreUrl = `${FIRESTORE_BASE}/projects/${PROJECT_ID}/databases/${DATABASE}/documents${pathWithQuery}`;
  
  console.log('🔗 Dynamic path:', pathWithQuery.split('?')[0]);
  console.log('🌐 Firestore URL:', firestoreUrl);
  console.log('🔑 Token preview:', authToken.substring(0, 30) + '...');

  try {
    const firestoreResponse = await fetch(firestoreUrl, {
      method: method,
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json',
      },
      // Agregar timeout para evitar cuelgues
      signal: AbortSignal.timeout(10000) // 10 segundos
    });

    console.log('📤 Firestore response status:', firestoreResponse.status);
    console.log('📤 Firestore response headers:', Object.fromEntries(firestoreResponse.headers.entries()));

    // Leer respuesta como texto primero
    const responseText = await firestoreResponse.text();
    console.log('📄 Response body preview:', responseText.substring(0, 300));

    // Verificar si es HTML de error
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      return res.status(502).json({
        error: 'Firestore returned HTML error page',
        firestoreStatus: firestoreResponse.status,
        firestoreUrl: firestoreUrl,
        hint: 'Revisa: 1) Token válido, 2) Collection existe, 3) URL correcta',
        htmlPreview: responseText.substring(0, 500)
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

    // ===== CONVERSIÓN A XML (SOLO SI SE SOLICITA) =====
    const wantsXml = acceptHeader.includes('xml');
    
    if (wantsXml) {
      // Limpiar datos de Firestore y convertir a XML
      const cleanedData = cleanFirestoreResponse(firestoreData);
      const xmlOutput = jsonToXml(cleanedData, 'firestoreResponse');
      
      // Devolver XML con header correcto
      return res
        .status(firestoreResponse.status)
        .setHeader('Content-Type', 'application/xml; charset=utf-8')
        .send(xmlOutput);
    } else {
      // ===== COMPORTAMIENTO ORIGINAL: DEVOLVER JSON =====
      return res.status(firestoreResponse.status).json(firestoreData);
    }

  } catch (error) {
    console.error('❌ Proxy error:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      return res.status(504).json({ error: 'Timeout connecting to Firestore' });
    }
    
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message,
      name: error.name
    });
  }
};
