module.exports = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    ok: true,
    service: "slk-deriv-relay",
    platform: "vercel-serverless",
    timestamp: new Date().toISOString(),
  });
};
