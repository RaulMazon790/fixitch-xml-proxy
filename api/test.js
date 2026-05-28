module.exports = async function handler(req, res) {
  try {
    return res.status(200).json({ 
      message: "Función ejecutada correctamente",
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error en test:', error);
    return res.status(500).json({ 
      error: 'Internal error', 
      message: error.message 
    });
  }
};
