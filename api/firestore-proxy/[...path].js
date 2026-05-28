// api/firestore-proxy/[...path].js
module.exports = async function handler(req, res) {
  const { method, headers, query } = req;
  
  // Obtener la ruta dinámica: query.path es un array como ['requests'] o ['requests', 'ID']
  const dynamicPath = query.path ? `/${query.path.join('/')}` : '';
  
  const acceptHeader = headers['accept'] || 'application/json';
  const authToken = headers['authorization'];

  if (!authToken || !authToken.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  // Construir URL de Firestore
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/fixitch-597f6/databases/(default)/documents${dynamicPath}`;

  try {
    const firestoreResponse = await fetch(firestoreUrl, {
      method: method,
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/json',
      }
    });

    const firestoreData = await firestoreResponse.json();
    const statusCode = firestoreResponse.status;
    const wantsXml = acceptHeader.includes('xml');

    if (wantsXml) {
      // Aquí iría la conversión a XML (xml2js) cuando funcione lo básico
      return res.status(statusCode).json({ 
        message: "XML conversion not yet enabled", 
        data: firestoreData 
      });
    } else {
      return res.status(statusCode).json(firestoreData);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
