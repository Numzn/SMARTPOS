const fetch = require('node-fetch');

async function testCategories() {
  try {
    console.log('Testing categories endpoint...');
    const response = await fetch('http://localhost:4000/api/categories');
    console.log('Response status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('Categories data:', JSON.stringify(data, null, 2));
    } else {
      const errorText = await response.text();
      console.log('Error response:', errorText);
    }
  } catch (error) {
    console.error('Fetch error:', error.message);
  }
}

testCategories();
