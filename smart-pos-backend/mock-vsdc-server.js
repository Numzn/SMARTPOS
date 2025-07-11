const express = require('express');
const app = express();
const PORT = 8090;

app.use(express.json());

// Mock ZRA VSDC endpoint
app.post('/trnsSales/saveSales', (req, res) => {
  console.log('🏪 Mock VSDC: Received sale data');
  console.log('📨 Payload:', JSON.stringify(req.body, null, 2));
  
  // Simulate processing delay
  setTimeout(() => {
    const mockResponse = {
      rcptNo: `MOCK-RCPT-${Date.now()}`,
      rcptSign: `FAKE-DIGITAL-SIGNATURE-${Math.random().toString(36).substr(2, 9)}`,
      qrCode: `https://mock.zra.zm/receipt/${Date.now()}`,
      status: 'SUCCESS',
      timestamp: new Date().toISOString(),
      message: 'Smart Invoice generated successfully'
    };
    
    console.log('📤 Mock VSDC: Sending response:', mockResponse);
    res.json(mockResponse);
  }, 2000); // 2 second delay to simulate real server processing
});

// Health check for mock server
app.get('/health', (req, res) => {
  res.json({ 
    message: 'Mock ZRA VSDC Server is running!',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /trnsSales/saveSales - Generate Smart Invoice',
      'GET /health - Health check'
    ]
  });
});

// Get server status
app.get('/status', (req, res) => {
  res.json({
    server: 'Mock ZRA VSDC',
    version: '1.0.0',
    uptime: process.uptime(),
    environment: 'development',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log('🟢 ========================================');
  console.log('🔧 Mock ZRA VSDC Server Started!');
  console.log('🟢 ========================================');
  console.log(`📍 Server URL: http://localhost:${PORT}`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  console.log(`📋 Main Endpoint: POST http://localhost:${PORT}/trnsSales/saveSales`);
  console.log('🟢 ========================================');
  console.log('💡 This simulates the real ZRA VSDC system');
  console.log('💡 Ready to receive Smart Invoice requests!');
  console.log('🟢 ========================================');
});
