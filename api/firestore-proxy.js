// api/firestore-proxy.js
import { Builder } from 'xml2js';

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const PROJECT_ID = 'fixitch-597f6';
const DATABASE = '(default)';

// Helper: Convertir JSON de Firestore a XML legible
function firestoreJsonToXml(jsonData, rootName = 'firestoreResponse') {
  function unwrapValue(field) {
    if (!field) return null;
    if (field.stringValue !== undefined) return field.stringValue;
    if (field.integerValue !== undefined) return parseInt(field.integerValue);
    if (field.arrayValue?.values) {
      return field.arrayValue.values.map(v => unwrapValue(v));
    }
    if (field.timestampValue) return field.timestampValue;
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

  let cleanedData = { ...jsonData };
  if (cleanedData.documents && Array.isArray(cleanedData.documents)) {
    cleanedData.documents = cleanedData.documents.map(cleanDocument);
  } else if (cleanedData.fields) {
    cleanedData = cleanDocument(cleanedData);
  }

  return new Builder({
    headless: false,
    renderOpts: { pretty: true, indent: '  ' },
    xmldec: { version: '1.0', encoding: 'UTF-8' }
  }).buildObject({ [rootName]: cleanedData });
}

// Handler compatible con Vercel Serverless Functions
export default async function handler(req, res) {
  const { method, headers, body } = req;
  const acceptHeader = headers['accept'] || 'application/json';
  const authToken = headers['authorization'];

  // Validar autenticación
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  // Construir URL de Firestore
  const path = req.url.replace(/^\/api\/firestore-proxy/, '');
  const firestoreUrl = `${FIRESTORE_BASE}/projects/${PROJECT_ID}/databases/${DATABASE}/documents${path}`;

  try {
    // Reenviar petición a Firestore
    const firestoreResponse = await fetch(firestoreUrl, {
      method: method,
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json',
      },
      ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {})
    });

    const firestoreData = await firestoreResponse.json();
    const statusCode = firestoreResponse.status;
    const wantsXml = acceptHeader.includes('xml');

    if (wantsXml) {
      // Devolver XML
      const xmlOutput = firestoreJsonToXml(firestoreData, 'firestoreResponse');
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.status(statusCode).send(xmlOutput);
    } else {
      // Devolver JSON
      return res.status(statusCode).json(firestoreData);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
