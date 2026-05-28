// api/firestore-proxy/[...path].js - Versión con debug de errores
module.exports = async function handler(req, res) {
  const { method, headers, query } = req;
  
  // Obtener la ruta dinámica: query.path es un array como ['requests']
  const dynamicPath = query.path ? `/${query.path.join('/')}` : '';
  
  const acceptHeader = headers['accept'] || 'application/json';
  const authToken = headers['authorization'];

  // Validar token
  if (!authToken || !authToken.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Authorization header required',
      hint: 'Debe ser: Bearer ya29.abc123...'
    });
  }

  // Construir URL de Firestore
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/fixitch-597f6/databases/(default)/documents${dynamicPath}`;
  
  console.log('🔍 Firestore URL:', firestoreUrl);
  console.log('🔑 Token starts with:', authToken.substring(0, 20) + '...');

  try {
    const firestoreResponse = await fetch(firestoreUrl, {
      method: method,
      headers: {
        'Authorization': authToken,  // ✅ Reenviamos el token exacto que recibió Postman
        'Content-Type': 'application/json',
      }
    });

    // 🔍 Leer la respuesta como texto PRIMERO para debug
    const responseText = await firestoreResponse.text();
    console.log('📦 Firestore status:', firestoreResponse.status);
    console.log('📦 Firestore headers:', Object.fromEntries(firestoreResponse.headers.entries()));
    console.log('📦 Firestore body (first 200 chars):', responseText.substring(0, 200));

    // Verificar si es HTML (error page)
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      return res.status(502).json({
        error: 'Firestore returned HTML instead of JSON',
        status: firestoreResponse.status,
        hint: 'Probablemente el token expiró o no tiene permisos',
        responseBody: responseText.substring(0, 500) // Primeros 500 chars del HTML
      });
    }

    // Intentar parsear como JSON
    let firestoreData;
    try {
      firestoreData = JSON.parse(responseText);
    } catch (parseError) {
      return res.status(502).json({
        error: 'Failed to parse Firestore response as JSON',
        rawResponse: responseText.substring(0, 300),
        parseError: parseError.message
      });
    }

    const statusCode = firestoreResponse.status;
    const wantsXml = acceptHeader.includes('xml');

    if (wantsXml) {
      // Conversión a XML (cuando funcione lo básico)
      return res.status(statusCode).json({ 
        message: "XML conversion enabled in next step", 
        data: firestoreData 
      });
    } else {
      return res.status(statusCode).json(firestoreData);
    }

  } catch (error) {
    console.error('❌ Proxy error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
