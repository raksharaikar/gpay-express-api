const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Import Axios
const app = express();
const { resolve } = require('path');
// Replace if using a different env file or config
const env = require('dotenv').config({ path: './.env' });



app.use(express.static(process.env.STATIC_DIR));
app.use(
  express.json({
    // We need the raw body to verify webhook signatures.
    // Let's compute it only when hitting the Stripe webhook endpoint.
    verify: function (req, res, buf) {
      if (req.originalUrl.startsWith('/webhook')) {
        req.rawBody = buf.toString();
      }
    },
  })
);
app.use(cors({
  origin: 'http://localhost:3000'
}));

app.get('/', (req, res) => {
  console.log('running');
});

app.get('/config', (req, res) => {
  res.send({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});


const stripe = require('stripe')('sk_test_51NaBJGSBFjaGRwYirY7lf4iw020nQuawshB1B84PNmpcBSHPJEi4uMGkTI6GYoJnJbT7PjkfLQoJ8JwFjC8urEqJ00LvRFSYr7');


// Define a route to receive the Google API token from the client
app.post('/google-token', async (req, res) => {
  const googleToken = req.body.paymentMethodData.tokenizationData.token; // Assuming the token is sent as JSON in the request body

  //console.log(JSON.parse(googleToken).id)
  const stripe = require('stripe')('sk_test_51NaBJGSBFjaGRwYirY7lf4iw020nQuawshB1B84PNmpcBSHPJEi4uMGkTI6GYoJnJbT7PjkfLQoJ8JwFjC8urEqJ00LvRFSYr7');



  try {


    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: { token: JSON.parse(googleToken).id },
    });


    // Create a Stripe Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: parseInt(req.body.transactionInfo.totalPrice + '00'), // Amount in cents (replace with your desired amount)
      currency: 'inr', // Currency (replace as needed)
      description: 'Payment for a product',
      payment_method_types: ['card'],
      payment_method: paymentMethod.id,
      confirmation_method: "automatic"
    });

    // Confirm the Payment Intent
    const confirmPayment = await stripe.paymentIntents.confirm(paymentIntent.id);


    // If the payment requires action (e.g., 3D Secure), the status will be 'requires_action'
    if (confirmPayment.status === 'requires_action') {
      // Send the client secret and next action to the client
      res.json({
        requiresAction: true,
        clientSecret: paymentIntent.client_secret,
        nextAction: paymentIntent.next_action,
      });
    } else if (confirmPayment.status === 'succeeded') {
      // Payment succeeded
      res.json({ success: true, message: 'Payment confirmed successfully.' });
    } else {
      // Payment confirmation failed
      res.json({ success: false, message: 'Payment confirmation failed.' });
    }
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ error: error.message });
  }
});



app.post('/issue-order', async (req, res) => {


  const fetch = await import('node-fetch');

    // Your SendOwl API Key and Secret
    const apiKey = '6a89269f397635b_hh';
    const apiSecret = '2e8e1ccce0bc6e966995_hh';

    // Create a base64-encoded string of "apiKey:apiSecret"
    const base64Credentials = btoa(`${apiKey}:${apiSecret}`);

    // Assuming product_code is sent in the request body
 

  try {
    const sendOwlResponse = await axios.post(`https://${apiKey}:${apiSecret}@www.sendowl.com/api/v1_2/products/${req.body.order.product.code}/issue`, req.body, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
       
      },
    });

    
    if (sendOwlResponse.status === 200) {
      console.error("success");

     console.log(sendOwlResponse)
    }

    const responseData = await sendOwlResponse.json();
    res.json(responseData);
  } catch (error) {
    console.error(error);
    
    res.status(500).json({ error: 'Internal server error' });
  }
});



app.post('/create-payment-intent', async (req, res) => {
  const { paymentMethodType, currency, paymentMethodOptions } = req.body;


  const params = {
    amount: 100,
    currency: "inr",
    paymentMethod: "toke_visa"
  }






  // Create a PaymentIntent with the amount, currency, and a payment method type.
  //
  // See the documentation [0] for the full list of supported parameters.
  //
  // [0] https://stripe.com/docs/api/payment_intents/create
  try {
    const paymentIntent = await stripe.paymentIntents.create(params);

    // Send publishable key and PaymentIntent details to client
    res.send({
      clientSecret: paymentIntent.client_secret,
      nextAction: paymentIntent.next_action,
    });
  } catch (e) {
    return res.status(400).send({
      error: {
        message: e.message,
      },
    });
  }
});

app.get('/payment/next', async (req, res) => {
  const intent = await stripe.paymentIntents.retrieve(
    req.query.payment_intent,
    {
      expand: ['payment_method'],
    }
  );

  res.redirect(`/success?payment_intent_client_secret=${intent.client_secret}`);
});

app.get('/success', async (req, res) => {
  const path = resolve(process.env.STATIC_DIR + '/success.html');
  res.sendFile(path);
});

// Expose a endpoint as a webhook handler for asynchronous events.
// Configure your webhook in the stripe developer dashboard
// https://dashboard.stripe.com/test/webhooks
app.post('/webhook', async (req, res) => {
  let data, eventType;

  // Check if webhook signing is configured.
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    // Retrieve the event by verifying the signature using the raw body and secret.
    let event;
    let signature = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
     // console.log(`⚠️  Webhook signature verification failed.`);
      return res.sendStatus(400);
    }
    data = event.data;
    eventType = event.type;
  } else {
    // Webhook signing is recommended, but if the secret is not configured in `config.js`,
    // we can retrieve the event data directly from the request body.
    data = req.body.data;
    eventType = req.body.type;
  }

  if (eventType === 'payment_intent.succeeded') {
    // Funds have been captured
    // Fulfill any orders, e-mail receipts, etc
    // To cancel the payment after capture you will need to issue a Refund (https://stripe.com/docs/api/refunds)
   // console.log('💰 Payment captured!');
  } else if (eventType === 'payment_intent.payment_failed') {
    //console.log('❌ Payment failed.');
  }
  res.sendStatus(200);
});

app.listen(3000, () =>
   console.log(`Node server listening at http://localhost:4242`)
);
