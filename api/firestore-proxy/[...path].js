// api/firestore-proxy/[...path].js - Versión con debug máximo
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

  // === OPCIÓN A: Hardcode para prueba (descomenta para probar) ===
  // Esto ignora query.path y usa una ruta fija conocida
  const dynamicPath = '/requests';  // ← Descomenta esta línea para probar
  
  // === OPCIÓN B: Ruta dinámica normal ===
  //const dynamicPath = query.path ? `/${query.path.join('/')}` : '';
  
  console.log('🔗 Dynamic path:', dynamicPath);

  // Construir URL de Firestore
  const PROJECT_ID = 'fixitch-597f6';
  const DATABASE = '(default)';
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents${dynamicPath}`;
  
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

    // Respuesta exitosa
    const wantsXml = acceptHeader.includes('xml');
    if (wantsXml) {
      return res.status(firestoreResponse.status).json({
        message: "XML conversion ready in next step",
        data: firestoreData
      });
    } else {
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
