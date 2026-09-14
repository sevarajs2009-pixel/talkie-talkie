require('dotenv').config();

const Razorpay = require('razorpay');

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

console.log('Key ID loaded:', !!keyId);
console.log('Key prefix:', keyId ? keyId.substring(0, 8) : 'MISSING');
console.log('Secret loaded:', !!keySecret);
console.log('Secret length:', keySecret ? keySecret.length : 0);

const razorpay = new Razorpay({
  key_id: keyId,
  key_secret: keySecret
});

async function testRazorpay() {
  try {
    const order = await razorpay.orders.create({
      amount: 1000,
      currency: 'INR',
      receipt: `test_${Date.now()}`
    });

    console.log('SUCCESS!');
    console.log('Order ID:', order.id);
    console.log('Amount:', order.amount);
    console.log('Currency:', order.currency);
  } catch (error) {
    console.log('RAZORPAY TEST FAILED');
    console.log(error);
  }
}

testRazorpay();