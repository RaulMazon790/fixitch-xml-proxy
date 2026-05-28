// api/test.js
module.exports = async function handler(req, res) {
  return res.status(200).json({ 
    message: "Proxy funciona", 
    url: req.url,
    method: req.method 
  });
};
