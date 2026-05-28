// api/firestore-proxy.js - Versión mínima de prueba
module.exports = async function handler(req, res) {
  try {
    return res.status(200).json({ 
      message: "firestore-proxy.js está activo",
      url: req.url,
      method: req.method,
      path: req.url?.split('?')[0]
    });
  } catch (error) {
    console.error('Error en firestore-proxy:', error);
    return res.status(500).json({ 
      error: 'Internal error', 
      message: error.message 
    });
  }
};
