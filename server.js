

const crypto = require('crypto');
const Razorpay = require('razorpay');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');


const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ?.replace(/^"|"$/g, '')
  .replace(/\\n/g, '\n')
  .trim();


const firebaseProjectId = process.env.FIREBASE_PROJECT_ID
  ?.replace(/^"|"$/g, '')
  .trim();

const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL
  ?.replace(/^"|"$/g, '')
  .trim();

  
if (!firebaseProjectId) {
  throw new Error("FIREBASE_PROJECT_ID is missing");
}

if (!firebaseClientEmail) {
  throw new Error("FIREBASE_CLIENT_EMAIL is missing");
}

if (!privateKey) {
  throw new Error("FIREBASE_PRIVATE_KEY is missing");
}

const serviceAccount = {
  projectId: firebaseProjectId,
  clientEmail: firebaseClientEmail,
  privateKey
};

initializeApp({
  credential: cert(serviceAccount)
});

const firestore = getFirestore();
const firebaseAuth = getAuth();
const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
console.log('--- Razorpay configuration check ---');
console.log('Key ID loaded:', !!razorpayKeyId);
console.log('Key ID prefix:', razorpayKeyId ? razorpayKeyId.substring(0, 8) : 'MISSING');
console.log('Secret loaded:', !!razorpayKeySecret);
console.log('Secret length:', razorpayKeySecret ? razorpayKeySecret.length : 0);
console.log('------------------------------------');


const razorpay =
  razorpayKeyId && razorpayKeySecret
    ? new Razorpay({
        key_id: razorpayKeyId,
        key_secret: razorpayKeySecret
      })
    : null;
async function verifyFirebaseToken(req) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('NO_TOKEN');
  }

  const idToken = authHeader.substring(7).trim();

  if (!idToken) {
    throw new Error('NO_TOKEN');
  }

  return await firebaseAuth.verifyIdToken(idToken);
}


const app = express();


const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================================
// GENERAL SUPPORT DESK — EMAIL TICKET
// Sends authenticated user support requests to the owner email.
// ============================================================

app.post('/api/support/ticket', async (req, res) => {
  try {
    // User must be logged in with Firebase
    const decodedToken = await verifyFirebaseToken(req);

    const userEmail = decodedToken.email || 'Unknown email';
    const uid = decodedToken.uid;

    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();

    // Validate required fields
    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Subject and message are required.'
      });
    }

    // Prevent excessively large support requests
    if (subject.length > 150) {
      return res.status(400).json({
        success: false,
        message: 'Subject is too long.'
      });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Message is too long. Maximum 5000 characters.'
      });
    }

    const resendApiKey =
      process.env.TALKIETALKIE_SUPPORT_RESEND_API_KEY;

    if (!resendApiKey) {
      console.error(
        'TALKIETALKIE_SUPPORT_RESEND_API_KEY is missing.'
      );

      return res.status(503).json({
        success: false,
        message: 'Support email service is not configured.'
      });
    }

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>TalkieTalkie General Support Ticket</h2>

        <p>
          <strong>Subject:</strong>
          ${subject.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </p>

        <p>
          <strong>User Email:</strong>
          ${userEmail.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </p>

        <p>
          <strong>Firebase UID:</strong>
          ${uid}
        </p>

        <hr>

        <h3>User Message</h3>

        <p style="white-space: pre-wrap;">
          ${message
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')}
        </p>
      </div>
    `;

    const resendResponse = await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`
        },

        body: JSON.stringify({
          from: 'TalkieTalkie Support <onboarding@resend.dev>',
          to: ['sevarajs2009@gmail.com'],
          subject: `[TalkieTalkie Support] ${subject}`,
          html: emailHtml
        })
      }
    );

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error(
        'Resend support email error:',
        resendData
      );

      return res.status(502).json({
        success: false,
        message: 'Unable to send support ticket email.'
      });
    }

    console.log(
      `Support ticket sent | UID: ${uid} | Email: ${userEmail} | Resend ID: ${resendData.id}`
    );

    return res.status(200).json({
      success: true,
      message: 'Support ticket sent successfully.'
    });

  } catch (error) {

    console.error(
      'Support ticket error:',
      error
    );

    if (
      error.message === 'NO_TOKEN' ||
      error.code === 'auth/id-token-expired' ||
      error.code === 'auth/argument-error' ||
      error.code === 'auth/invalid-id-token'
    ) {
      return res.status(401).json({
        success: false,
        message: 'Please log in again before sending a support ticket.'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Unable to send support ticket.'
    });
  }
});

// ============================================================
// RAZORPAY PAYMENT ROUTES
// ============================================================

// Create a Razorpay order
app.post('/api/payment/create-order', async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(503).json({
        success: false,
        message: 'Payment gateway is not configured on the server.'
      });
    }

    // Verify Firebase login
    const decodedToken = await verifyFirebaseToken(req);
    const uid = decodedToken.uid;

    // Product information
    const plan = req.body.plan || 'extra_room_india';

    // IMPORTANT:
    // Razorpay amount is in the smallest currency unit.
    // â‚¹100 = 10000 paise.
    //
    // Change this amount when your final pricing is decided.
    const plans = {
  // EXISTING PLAN â€” DO NOT CHANGE
  extra_room_india: {
    amount: 8000, // â‚¹80 = 8000 paise
    currency: 'INR',
    name: 'TalkieTalkie Extra Room - India'
  },

  // EXISTING PLAN â€” DO NOT CHANGE
  extra_room_usd: {
    amount: 100, // $1 = 100 cents
    currency: 'USD',
    name: 'TalkieTalkie Extra Room - International'
  },

  // NEW COMMON $3 UPGRADE
  premium_upgrade: {
    amount: 300, // $3 = 300 cents
    currency: 'USD',
    name: 'TalkieTalkie Premium Upgrade'
  }
};

    const selectedPlan = plans[plan];

    if (!selectedPlan) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment plan.'
      });
    }

    const receipt = `tt_${uid}_${Date.now()}`;

    const order = await razorpay.orders.create({
      amount: selectedPlan.amount,
      currency: selectedPlan.currency,
      receipt,
      notes: {
        uid,
        plan
      }
    });

    // Save the pending order in Firestore
    await firestore
      .collection('paymentOrders')
      .doc(order.id)
      .set({
        uid,
        orderId: order.id,
        plan,
        amount: selectedPlan.amount,
        currency: selectedPlan.currency,
        status: 'created',
        createdAt: new Date().toISOString()
      });

    return res.status(200).json({
      success: true,
      keyId: razorpayKeyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      plan,
      name: selectedPlan.name
    });

  } catch (error) {
    console.error('Create Razorpay order error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to create payment order.'
    });
  }
});


// Verify Razorpay payment
app.post('/api/payment/verify', async (req, res) => {
  console.log('>>> PAYMENT VERIFY ROUTE CALLED');
  try {
    if (!razorpay) {
      return res.status(503).json({
        success: false,
        message: 'Payment gateway is not configured on the server.'
      });
    }

    // Verify Firebase login
    const decodedToken = await verifyFirebaseToken(req);
    const uid = decodedToken.uid;

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: 'Incomplete payment verification data.'
      });
    }

    // Get the order that OUR server created
    const orderRef = firestore
      .collection('paymentOrders')
      .doc(razorpay_order_id);

    const orderSnapshot = await orderRef.get();

    if (!orderSnapshot.exists) {
      return res.status(404).json({
        success: false,
        message: 'Payment order not found.'
      });
    }

    const orderData = orderSnapshot.data();

    // Make sure this order belongs to the logged-in Firebase user
    if (orderData.uid !== uid) {
      return res.status(403).json({
        success: false,
        message: 'Payment order does not belong to this account.'
      });
    }

    // Prevent processing the same order twice
    if (orderData.status === 'paid') {
      return res.status(200).json({
        success: true,
        message: 'Payment was already verified.'
      });
    }

    // Razorpay signature verification
    const generatedSignature = crypto
      .createHmac('sha256', razorpayKeySecret)
      .update(
        `${orderData.orderId}|${razorpay_payment_id}`
      )
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      await orderRef.update({
        status: 'verification_failed',
        verificationFailedAt: new Date().toISOString()
      });

      return res.status(400).json({
        success: false,
        message: 'Payment signature verification failed.'
      });
    }

    // --------------------------------------------------------
    // PAYMENT IS AUTHENTIC
    // --------------------------------------------------------

    await orderRef.update({
      status: 'paid',
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      paidAt: new Date().toISOString()
    });

    // Save payment history
    await firestore
      .collection('users')
      .doc(uid)
      .collection('payments')
      .doc(razorpay_payment_id)
      .set({
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        plan: orderData.plan,
        amount: orderData.amount,
        currency: orderData.currency,
        status: 'paid',
        paidAt: new Date().toISOString()
      });

    // --------------------------------------------------------
    // GRANT ENTITLEMENT
    // --------------------------------------------------------

    const entitlementRef = firestore
      .collection('users')
      .doc(uid)
      .collection('entitlements')
      .doc(orderData.plan);

    const entitlementSnapshot = await entitlementRef.get();

    let currentQuantity = 0;

    if (entitlementSnapshot.exists) {
      currentQuantity =
        Number(entitlementSnapshot.data().quantity || 0);
    }

    await entitlementRef.set({
      plan: orderData.plan,
      quantity: currentQuantity + 1,
      active: true,
      updatedAt: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: 'Payment verified and entitlement activated.',
      plan: orderData.plan
    });

  } catch (error) {
    console.error('Razorpay payment verification error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to verify payment.'
    });
  }
});


// Get current payment/entitlement status
app.get('/api/payment/status', async (req, res) => {
  try {
    const decodedToken = await verifyFirebaseToken(req);
    const uid = decodedToken.uid;

    const entitlementSnapshot = await firestore
      .collection('users')
      .doc(uid)
      .collection('entitlements')
      .get();

    const entitlements = {};

    entitlementSnapshot.forEach((doc) => {
      entitlements[doc.id] = doc.data();
    });

    return res.status(200).json({
      success: true,
      entitlements
    });

  } catch (error) {
    console.error('Payment status error:', error);

    return res.status(401).json({
      success: false,
      message: 'Unable to read payment status.'
    });
  }
});






const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// In-memory Data Stores (Cleaned up with zero pre-existing rooms)
const users = [];
const rooms = [];
const activeRoomSockets = new Map();
// ============================================================
// BUSINESS CHAT â€” IN-MEMORY CHAT HISTORY
// Business rooms only
// ============================================================
const roomChatHistory = new Map();

function isBusinessRoomType(roomType) {
  return String(roomType || '').toLowerCase() === 'business';
}

function getRoomType(room) {
  return String(room?.roomType || room?.type || '').toLowerCase();
}

function getBusinessChatHistory(roomId) {
  return roomChatHistory.get(String(roomId)) || [];
}

function addBusinessChatMessage(roomId, message) {
  const key = String(roomId);

  const history = roomChatHistory.get(key) || [];

  history.push(message);

  // Keep only the latest 50 messages
  if (history.length > 50) {
    history.splice(0, history.length - 50);
  }

  roomChatHistory.set(key, history);
}

function broadcastBusinessChat(roomId, payload) {
  const roomSockets = activeRoomSockets.get(roomId);

  if (!roomSockets) return;

  for (const client of roomSockets) {
    if (
      client.readyState === WebSocket.OPEN &&
      isBusinessRoomType(client.roomType)
    ) {
      client.send(JSON.stringify(payload));
    }
  }
}
const roomSettings = new Map();




// Firebase users who successfully verified a private room passcode
const verifiedRoomAccess = new Map();

function getRoomMemberCount(roomId) {
  const roomSockets = activeRoomSockets.get(roomId);
  if (!roomSockets) return 0;
  let count = 0;
  for (const client of roomSockets) {
    if (client.readyState === WebSocket.OPEN) {
      count++;
    }
  }
  return count;
}



function isAdminInRoom(roomId) {

  const roomSockets = activeRoomSockets.get(roomId);

  if (!roomSockets) return false;

  for (const client of roomSockets) {

    if (
      client.readyState === WebSocket.OPEN &&
      client.userRole &&
      client.userRole.toLowerCase() === 'admin'
    ) {
      return true;
    }

  }

  return false;
}


// ============================================================
// CHECK WHETHER A ROOM OWNER HAS MEMBER UPGRADE
// ============================================================
async function hasUnlimitedMembers(room) {
  try {
    if (!room || !room.ownerUid) {
      return false;
    }

    const entitlementSnapshot = await firestore
      .collection('users')
      .doc(room.ownerUid)
      .collection('entitlements')
      .get();

    let hasUpgrade = false;

    entitlementSnapshot.forEach((doc) => {
      const data = doc.data();

      const isValidPlan =
        doc.id === 'extra_room' ||
        doc.id === 'extra_room_india' ||
        doc.id === 'extra_room_usd'||
        doc.id === 'premium_upgrade';

      if (
        isValidPlan &&
        data.active === true &&
        Number(data.quantity || 0) > 0
      ) {
        hasUpgrade = true;
      }
    });

    return hasUpgrade;

  } catch (error) {
    console.error('Member upgrade check failed:', error);
    return false;
  }
}

function updateRoomGuestsList(roomId) {
  const room = rooms.find(r => String(r.id) === String(roomId));
  if (!room) return;

  const roomSockets = activeRoomSockets.get(roomId);
  if (!roomSockets) {
    room.guests = [];
    return;
  }

  const currentGuests = [];
  for (const client of roomSockets) {
    if (client.readyState === WebSocket.OPEN) {
      currentGuests.push({
        name: client.userName,
        role: client.userRole,
        joinedAt: client.joinedAt || new Date().toLocaleTimeString()
      });
    }
  }
  room.guests = currentGuests;
}

function broadcastRoomMembers(roomId) {
  const roomSockets = activeRoomSockets.get(roomId);
  if (!roomSockets) return;

  const members = [];
  for (const client of roomSockets) {
    if (client.readyState === WebSocket.OPEN) {
      members.push({ userName: client.userName, role: client.userRole });
    }
  }

  const currentSettings = roomSettings.get(roomId) || { sosMode: '10s' };

  const payload = JSON.stringify({ 
    type: 'ROOM_STATE_UPDATE', 
    members,
    sosMode: currentSettings.sosMode
  });

  for (const client of roomSockets) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}



// Fetch Admin Dashboard Data (FILTERED BY CREATOR USERNAME)
app.get('/api/admin/data', (req, res) => {
  const currentUser = req.query.username;

  const userRooms = currentUser 
    ? rooms.filter(r => r.createdBy === currentUser)
    : rooms;

  return res.status(200).json({
    success: true,
    users: users || [],
    rooms: userRooms
  });
});

// Search Rooms Endpoint (Case-insensitive search by Name or ID)
app.get('/api/rooms/search', (req, res) => {
  const query = req.query.q ? req.query.q.trim().toLowerCase() : '';

  if (!query) {
    return res.status(200).json({ success: true, rooms: [] });
  }

  const matchedRooms = rooms.filter(r => 
    String(r.id).toLowerCase() === query ||
    r.roomName.toLowerCase().includes(query)
  );

  return res.status(200).json({
    success: true,
    rooms: matchedRooms.map(r => ({
      id: r.id,
      roomName: r.roomName,
      roomType: r.roomType,
      isPrivate: r.isPrivate,
      createdBy: r.createdBy,
      memberCount: getRoomMemberCount(r.id),
      isAdminPresent: isAdminInRoom(r.id)
    }))
  });
});

// Create Voice Room Endpoint (ACCOUNT SPECIFIC)
app.post('/api/admin/rooms', (req, res) => {
  const { roomName, roomType, roomPassword, createdBy } = req.body;
  if (!roomName) {
    return res.status(400).json({ success: false, message: 'Room name is required.' });
  }

  const normalizedType = roomType ? roomType.toLowerCase() : 'business';
  if (!['family', 'business'].includes(normalizedType)) {
    return res.status(400).json({ success: false, message: 'Room type must be "family" or "business".' });
  }
  
  const creator = createdBy || 'Administrator';

  const existingCategoryRoom = rooms.find(
    r => r.createdBy === creator && r.roomType === normalizedType
  );

  if (existingCategoryRoom) {
    return res.status(400).json({ 
      success: false, 
      code: 'LIMIT_ROOM_CREATE',
      message: `Limit Reached: You have already created a ${normalizedType.toUpperCase()} voice room. You can only create 1 Family room and 1 Business room.` 
    });
  }

  const newRoom = {
    id: String(Date.now()),
    roomName: roomName.trim(),
    roomType: normalizedType,
    roomPassword: roomPassword ? roomPassword.trim() : '',
    isPrivate: Boolean(roomPassword && roomPassword.trim() !== ''),
    createdBy: creator,
    guests: []
  };

  rooms.push(newRoom);

  const userRooms = rooms.filter(r => r.createdBy === creator);

  return res.status(201).json({ 
    success: true, 
    message: `${normalizedType.toUpperCase()} room created successfully!`, 
    room: newRoom,
    rooms: userRooms 
  });
});

// Update Voice Room Settings Endpoint
app.put('/api/admin/rooms/:id', (req, res) => {
  const { id } = req.params;
  const { roomName, roomType, roomPassword, username } = req.body;

  const room = rooms.find(r => String(r.id) === String(id));
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found.' });
  }

  if (roomName) room.roomName = roomName.trim();
  if (roomType) room.roomType = roomType.toLowerCase();
  if (roomPassword !== undefined) {
    room.roomPassword = roomPassword.trim();
    room.isPrivate = Boolean(roomPassword.trim() !== '');
  }

  const userRooms = username ? rooms.filter(r => r.createdBy === username) : rooms;

  return res.status(200).json({
    success: true,
    message: 'Room updated successfully!',
    room,
    rooms: userRooms
  });
});

// Delete User Endpoint
app.delete('/api/admin/users/:id', (req, res) => {
  const { id } = req.params;
  const userIndex = users.findIndex(u => String(u.id) === String(id));

  if (userIndex === -1) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  users.splice(userIndex, 1);
  return res.status(200).json({ success: true, message: 'User deleted successfully.' });
});

// Join Room Verification Endpoint
app.post('/api/rooms/join', (req, res) => {
  const { roomId, roomName, roomPassword, username, requestedRole } = req.body;
  const room = rooms.find(r => (roomId && String(r.id) === String(roomId)) || (roomName && r.roomName.toLowerCase() === roomName.trim().toLowerCase()));
  if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });

  const requiredPassword = room.roomPassword || '';
  const providedPassword = roomPassword || '';
  if (room.isPrivate && requiredPassword !== providedPassword.trim()) {
    return res.status(401).json({ success: false, message: 'Incorrect room password.' });
  }

  const role = requestedRole || 'Guest';
  if (role.toLowerCase() === 'guest' && !isAdminInRoom(room.id)) {
    return res.status(403).json({ success: false, message: 'Access Denied: Admin not present in the room.' });
  }

  const currentMemberCount = getRoomMemberCount(room.id);
  if (currentMemberCount >= 6) {
    return res.status(403).json({ 
      success: false, 
      code: 'LIMIT_ROOM_FULL',
      message: 'Room is full: Maximum capacity is 6 members (1 Admin + 5 Guests).' 
    });
  }

  const finalUserName = username || (role.toLowerCase() === 'admin' ? 'Administrator' : 'Guest User');

  const matchedUser = users.find(u => u.username.toLowerCase() === finalUserName.toLowerCase());
  if (matchedUser) {
    if (role.toLowerCase() === 'admin') {
      matchedUser.adminLogins = (matchedUser.adminLogins || 0) + 1;
    } else {
      matchedUser.guestLogins = (matchedUser.guestLogins || 0) + 1;
    }
  }

  return res.status(200).json({ success: true, room, role, guestName: finalUserName });
});
// Firebase Secure Room Verification Endpoint
app.post('/api/rooms/verify', async (req, res) => {
  console.log("ROOM VERIFY REQUEST RECEIVED");
console.log("Authorization header exists:", !!req.headers.authorization);
  try {
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Firebase authentication token is required.'
      });
    }

    const idToken = authHeader.substring(7);

    // Verify the logged-in Firebase user
    let decodedToken;

try {
  decodedToken = await firebaseAuth.verifyIdToken(idToken);
} catch (tokenError) {
  console.error("ROOM VERIFY TOKEN ERROR:", tokenError);

  return res.status(401).json({
    success: false,
    message: "Firebase authentication failed.",
    error: tokenError.code || tokenError.message
  });
}

const guestUid = decodedToken.uid;

    const { roomId, roomName, secureKey } = req.body;

    if ((!roomId && !roomName) || !secureKey) {
      return res.status(400).json({
        success: false,
        message: 'Room ID/name and passcode are required.'
      });
    }

    const searchValue = (roomId || roomName).trim().toLowerCase();

    // Find the room in the public room directory
    const roomsSnapshot = await firestore.collection('rooms').get();

    let targetRoom = null;

    roomsSnapshot.forEach((roomDoc) => {
      const room = roomDoc.data();

      if (
        roomDoc.id.trim().toLowerCase() === searchValue ||
        (room.roomId &&
          room.roomId.trim().toLowerCase() === searchValue) ||
        (room.name &&
          room.name.trim().toLowerCase() === searchValue)
      ) {
        targetRoom = {
          id: roomDoc.id,
          ...room
        };
      }
    });

    if (!targetRoom) {
      return res.status(404).json({
        success: false,
        message: 'Room not found.'
      });
    }

    if (targetRoom.status && targetRoom.status !== 'Active') {
      return res.status(403).json({
        success: false,
        message: 'This room is not currently active.'
      });
    }

    if (!targetRoom.ownerUid) {
      return res.status(500).json({
        success: false,
        message: 'Room owner information is missing.'
      });
    }

    // Read the private room document belonging to the owner
    const privateRoomRef = firestore
      .collection('users')
      .doc(targetRoom.ownerUid)
      .collection('managedRooms')
      .doc(targetRoom.roomId || targetRoom.id);

    const privateRoomSnapshot = await privateRoomRef.get();

    if (!privateRoomSnapshot.exists) {
      return res.status(404).json({
        success: false,
        message: 'Private room information was not found.'
      });
    }

    const privateRoom = privateRoomSnapshot.data();

    // Verify the passcode
    if (String(privateRoom.secureKey || '').trim() !== String(secureKey).trim()) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect room passcode.'
      });
    }

    // Guests can join only when the Admin is currently inside the room
const liveRoomId = targetRoom.roomId || targetRoom.id;

if (!isAdminInRoom(liveRoomId)) {
  return res.status(403).json({
    success: false,
    code: 'ADMIN_NOT_PRESENT',
    message: 'Access denied: The Admin is not currently present in this voice room.'
  });
}

  const verifiedRoomId = targetRoom.id;

verifiedRoomAccess.set(
  `${guestUid}:${verifiedRoomId}`,
  {
    uid: guestUid,
    roomId: verifiedRoomId,
    verifiedAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000
  }
);
    console.log(
      `Guest ${guestUid} successfully verified for room ${targetRoom.roomId || targetRoom.id}`
    );

    // Never send secureKey back to the browser
    return res.status(200).json({
      success: true,
      message: 'Room passcode verified successfully.',
      room: {
        roomId: targetRoom.roomId || targetRoom.id,
        name: targetRoom.name,
        type: targetRoom.type,
        status: targetRoom.status,
        members: targetRoom.members,
        ownerUid: targetRoom.ownerUid
      }
    });

  } catch (error) {
    console.error('Firebase room verification error:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error while verifying the room.'
    });
  }
});
// WebSocket Server & Upgrade Handler

server.on('upgrade', async (request, socket, head) => {
  try {
    const requestUrl = new URL(
      request.url,
      `http://${request.headers.host}`
    );

    const pathname = requestUrl.pathname;

    if (pathname !== '/ws/room') {
      socket.destroy();
      return;
    }

    // Firebase ID token is temporarily passed through the WebSocket URL.
    const idToken = requestUrl.searchParams.get('token');

    if (!idToken) {
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\n' +
        'Connection: close\r\n\r\n'
      );
      socket.destroy();
      return;
    }

    // Verify the Firebase user before allowing the WebSocket connection.
    const decodedToken = await firebaseAuth.verifyIdToken(idToken);

    // Store the verified Firebase identity on the WebSocket.
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.firebaseUid = decodedToken.uid;
      ws.firebaseEmail = decodedToken.email || null;

      wss.emit('connection', ws, request);
    });

  } catch (error) {
    console.error('WebSocket Firebase authentication failed:', error.message);

    socket.write(
      'HTTP/1.1 401 Unauthorized\r\n' +
      'Connection: close\r\n\r\n'
    );

    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.userName = null;
  ws.roomType = null;
  ws.userRole = null;
  ws.joinedAt = null;
  ws.isSosMuted = false;
  // Business Video Conference
ws.videoPeerId = crypto.randomUUID();
ws.videoConferenceActive = false;

  ws.on('message', async (message, isBinary) => {
    if (isBinary) {
      if (!ws.roomId) return;
      const roomSockets = activeRoomSockets.get(ws.roomId);
      if (roomSockets) {
        for (const client of roomSockets) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            if (ws.isSosActive && client.isSosMuted && client.userRole.toLowerCase() === 'guest') {
              continue;
            }
            client.send(message, { binary: true });
          }
        }
      }
      return;
    }

    try {
      const data = JSON.parse(message.toString());

      if (data.type === 'JOIN_ROOM') {
  try {
    const requestedRoomId = String(data.roomId || '').trim();

    if (!requestedRoomId) {
      ws.send(JSON.stringify({
        type: 'JOIN_ERROR',
        message: 'Room ID is required.'
      }));
      ws.close();
      return;
    }

    // Find the room in Firestore
    const roomRef = firestore.collection('rooms').doc(requestedRoomId);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) {
      ws.send(JSON.stringify({
        type: 'JOIN_ERROR',
        message: 'Room not found.'
      }));
      ws.close();
      return;
    }

    const room = roomSnapshot.data();

    // Room must be active
    if (room.status && room.status !== 'Active') {
      ws.send(JSON.stringify({
        type: 'JOIN_ERROR',
        message: 'This room is not currently active.'
      }));
      ws.close();
      return;
    }

    // Firebase identity was verified when WebSocket connected
    const firebaseUid = ws.firebaseUid;

    if (!firebaseUid) {
      ws.send(JSON.stringify({
        type: 'JOIN_ERROR',
        message: 'Firebase identity is missing.'
      }));
      ws.close();
      return;
    }

    /*
     * SECURITY:
     * Do not trust role or username sent by the browser.
     *
     * If this Firebase user owns the room,
     * they are the Admin.
     *
     * Otherwise, they are a Guest.
     */
    const isRoomOwner =
      String(room.ownerUid || '') === String(firebaseUid);

    const finalRole = isRoomOwner ? 'Admin' : 'Guest';

    // Check whether this guest has verified the room passcode
if (!isRoomOwner) {
  const accessKey = `${firebaseUid}:${roomSnapshot.id}`;
  const verifiedAccess = verifiedRoomAccess.get(accessKey);

  if (!verifiedAccess || verifiedAccess.expiresAt < Date.now()) {
    if (verifiedAccess) {
      verifiedRoomAccess.delete(accessKey);
    }

    ws.send(JSON.stringify({
      type: 'JOIN_ERROR',
      code: 'ROOM_VERIFICATION_REQUIRED',
      message: 'Please verify the room passcode before joining.'
    }));

    ws.close();
    return;
  }
}

    // Get the real username from Firestore
    const userRef = firestore.collection('users').doc(firebaseUid);
    const userSnapshot = await userRef.get();

    let finalUserName = ws.firebaseEmail || 'GuestUser';

    if (userSnapshot.exists) {
      const userData = userSnapshot.data();

      if (userData.username) {
        finalUserName = String(userData.username).trim();
      } else if (userData.fullName) {
        finalUserName = String(userData.fullName).trim();
      }
    }

    // Guests can enter only when an Admin is already inside
    if (finalRole === 'Guest' && !isAdminInRoom(requestedRoomId)) {
      ws.send(JSON.stringify({
        type: 'ADMIN_NOT_PRESENT'
      }));
      ws.close();
      return;
    }

    // Check room capacity
    // ============================================================
// ROOM MEMBER CAPACITY
// FREE ROOM  = 6 TOTAL MEMBERS
// UPGRADED   = HIGH CAPACITY
// ============================================================

const currentMemberCount =
  getRoomMemberCount(requestedRoomId);

const roomOwnerHasUpgrade =
  await hasUnlimitedMembers(room);

const FREE_ROOM_LIMIT = 6;

// Use a high server-safe ceiling instead of a literal
// infinite number of WebSocket connections.
const UPGRADED_ROOM_LIMIT = 1000;

const maximumMembers = roomOwnerHasUpgrade
  ? UPGRADED_ROOM_LIMIT
  : FREE_ROOM_LIMIT;

if (currentMemberCount >= maximumMembers) {

  ws.send(JSON.stringify({
    type: 'ROOM_FULL',
    code: roomOwnerHasUpgrade
      ? 'LIMIT_ROOM_CAPACITY'
      : 'LIMIT_ROOM_FULL',

    message: roomOwnerHasUpgrade
      ? 'This room has reached the current server capacity.'
      : 'Free room limit reached (1 Admin + 5 Guests). Upgrade to add more members.'
  }));

  ws.close();
  return;
}

    // Server-controlled identity
  ws.roomId = requestedRoomId;
ws.roomType = getRoomType(room);
ws.userRole = finalRole;
ws.userName = finalUserName;
ws.joinedAt = new Date().toLocaleTimeString();

    if (!activeRoomSockets.has(requestedRoomId)) {
      activeRoomSockets.set(requestedRoomId, new Set());
    }

    activeRoomSockets.get(requestedRoomId).add(ws);

    // Send Business chat history to the newly joined Business user
if (isBusinessRoomType(ws.roomType)) {
  ws.send(JSON.stringify({
    type: 'CHAT_HISTORY',
    messages: getBusinessChatHistory(requestedRoomId)
  }));
}

    if (!roomSettings.has(requestedRoomId)) {
      roomSettings.set(requestedRoomId, {
        sosMode: '10s'
      });
    }

    updateRoomGuestsList(requestedRoomId);
    broadcastRoomMembers(requestedRoomId);

    console.log(
      `WebSocket room joined | UID: ${firebaseUid} | Room: ${requestedRoomId} | Role: ${finalRole} | Username: ${finalUserName}`
    );

  } catch (error) {
    console.error('JOIN_ROOM authorization error:', error);

    ws.send(JSON.stringify({
      type: 'JOIN_ERROR',
      message: 'Unable to authorize room access.'
    }));

    ws.close();
  }
}

// ============================================================
// BUSINESS VIDEO CONFERENCE â€” WEBRTC SIGNALING
// ============================================================

if (
  data.type === 'VIDEO_JOIN' ||
  data.type === 'VIDEO_OFFER' ||
  data.type === 'VIDEO_ANSWER' ||
  data.type === 'VIDEO_ICE' ||
  data.type === 'VIDEO_LEAVE'
) {

  // Video Conference is Business-only
  if (!ws.roomId || !isBusinessRoomType(ws.roomType)) {
    ws.send(JSON.stringify({
      type: 'VIDEO_ERROR',
      message: 'Video Conference is available only in Business rooms.'
    }));
    return;
  }

  const roomSockets = activeRoomSockets.get(ws.roomId);

  if (!roomSockets) {
    return;
  }

  // ------------------------------------------------------------
  // VIDEO_JOIN
  // Tell the new participant who is already inside the
  // Business video conference.
  // ------------------------------------------------------------

  if (data.type === 'VIDEO_JOIN') {

      if (String(data.roomId || '') !== String(ws.roomId || '')) {
    ws.send(JSON.stringify({
      type: 'VIDEO_ERROR',
      message: 'Invalid video room.'
    }));
    return;
  }

    for (const client of roomSockets) {

      if (
        client !== ws &&
        client.readyState === WebSocket.OPEN &&
        client.videoConferenceActive === true
      ) {

        // Tell existing participant about the new participant
        client.send(JSON.stringify({
          type: 'VIDEO_PEER_JOINED',
          peerId: ws.videoPeerId,
          userName: ws.userName
        }));

        // Tell new participant about existing participant
        ws.send(JSON.stringify({
          type: 'VIDEO_EXISTING_PEER',
          peerId: client.videoPeerId,
          userName: client.userName
        }));
      }
    }

    ws.videoConferenceActive = true;

    console.log(
      `VIDEO JOIN | ${ws.userName} | Room: ${ws.roomId}`
    );

    return;
  }

  // ------------------------------------------------------------
  // VIDEO_OFFER
  // ------------------------------------------------------------

  if (data.type === 'VIDEO_OFFER') {

    const target = [...roomSockets].find(
      client => client.videoPeerId === data.targetPeerId
    );

    if (
      target &&
      target.readyState === WebSocket.OPEN &&
      target.videoConferenceActive === true
    ) {

      target.send(JSON.stringify({
        type: 'VIDEO_OFFER',
        fromPeerId: ws.videoPeerId,
        fromUserName: ws.userName,
        offer: data.offer
      }));
    }

    return;
  }

  // ------------------------------------------------------------
  // VIDEO_ANSWER
  // ------------------------------------------------------------

  if (data.type === 'VIDEO_ANSWER') {

    const target = [...roomSockets].find(
      client => client.videoPeerId === data.targetPeerId
    );

    if (
      target &&
      target.readyState === WebSocket.OPEN &&
      target.videoConferenceActive === true
    ) {

      target.send(JSON.stringify({
        type: 'VIDEO_ANSWER',
        fromPeerId: ws.videoPeerId,
        answer: data.answer
      }));
    }

    return;
  }

  // ------------------------------------------------------------
  // VIDEO_ICE
  // ------------------------------------------------------------

  if (data.type === 'VIDEO_ICE') {

    const target = [...roomSockets].find(
      client => client.videoPeerId === data.targetPeerId
    );

    if (
      target &&
      target.readyState === WebSocket.OPEN &&
      target.videoConferenceActive === true
    ) {

      target.send(JSON.stringify({
        type: 'VIDEO_ICE',
        fromPeerId: ws.videoPeerId,
        candidate: data.candidate
      }));
    }

    return;
  }

  // ------------------------------------------------------------
  // VIDEO_LEAVE
  // ------------------------------------------------------------

  if (data.type === 'VIDEO_LEAVE') {

    ws.videoConferenceActive = false;

    for (const client of roomSockets) {

      if (
        client !== ws &&
        client.readyState === WebSocket.OPEN
      ) {

        client.send(JSON.stringify({
          type: 'VIDEO_PEER_LEFT',
          peerId: ws.videoPeerId
        }));
      }
    }

    console.log(
      `VIDEO LEAVE | ${ws.userName} | Room: ${ws.roomId}`
    );

    return;
  }
}

      // ============================================================
// BUSINESS CHAT â€” SEND MESSAGE
// ============================================================
if (data.type === 'CHAT_SEND') {

  // Only Business rooms can use chat
  if (!isBusinessRoomType(ws.roomType)) {
    ws.send(JSON.stringify({
      type: 'CHAT_ERROR',
      message: 'Chat is available only in Business rooms.'
    }));
    return;
  }

  // Get message text
  const text = String(data.message || '').trim();

  // Ignore empty messages
  if (!text) {
    return;
  }

  // Limit message length
  if (text.length > 500) {
    ws.send(JSON.stringify({
      type: 'CHAT_ERROR',
      message: 'Message is too long. Maximum 500 characters.'
    }));
    return;
  }

  // Create the chat message
  const chatMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userName: ws.userName || 'User',
    message: text,
    sentAt: new Date().toISOString()
  };

  // Save message in Business room history
  addBusinessChatMessage(ws.roomId, chatMessage);

  // Send message to everyone in this Business room
  broadcastBusinessChat(ws.roomId, {
    type: 'CHAT_MESSAGE',
    message: chatMessage
  });
}

      if (data.type === 'SET_SOS_MODE') {
        if (ws.roomId && ws.userRole && ws.userRole.toLowerCase() === 'admin') {
          const mode = ['10s', '1m', 'unlimited'].includes(data.mode) ? data.mode : '10s';
          roomSettings.set(ws.roomId, { sosMode: mode });

          const roomSockets = activeRoomSockets.get(ws.roomId);
          if (roomSockets) {
            const payload = JSON.stringify({ type: 'SOS_MODE_UPDATED', mode });
            for (const client of roomSockets) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
              }
            }
          }
        }
      }

      if (data.type === 'SET_SOS_MUTE') {
        if (ws.userRole && ws.userRole.toLowerCase() === 'guest') {
          ws.isSosMuted = Boolean(data.muted);
          ws.send(JSON.stringify({ 
            type: 'SOS_MUTE_ACK', 
            muted: ws.isSosMuted 
          }));
        }
      }

      if (data.type === 'LOCATION_UPDATE') {
  if (!ws.roomId || !ws.userName) {
    return;
  }

  const location = data.location;

  if (
    !location ||
    typeof location !== 'object' ||
    typeof location.latitude !== 'number' ||
    typeof location.longitude !== 'number' ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    ws.send(JSON.stringify({
      type: 'LOCATION_ERROR',
      message: 'Invalid location data.'
    }));
    return;
  }

  const roomSockets = activeRoomSockets.get(ws.roomId);

  if (roomSockets) {
    const payload = JSON.stringify({
      type: 'LOCATION_BROADCAST',
      userName: ws.userName,
      location: {
        latitude: location.latitude,
        longitude: location.longitude
      }
    });

    for (const client of roomSockets) {
      if (
        client.readyState === WebSocket.OPEN &&
        client.userRole &&
        client.userRole.toLowerCase() === 'admin'
      ) {
        client.send(payload);
      }
    }
  }
}
      if (data.type === 'START_TALKING' || data.type === 'STOP_TALKING') {
        const roomSockets = activeRoomSockets.get(ws.roomId);
        if (roomSockets) {
          const evtType = data.type === 'START_TALKING' ? 'USER_TRANSMITTING' : 'USER_STOPPED_TRANSMITTING';
          const payload = JSON.stringify({ type: evtType, userName: ws.userName });
          for (const client of roomSockets) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(payload);
            }
          }
        }
      }

      if (data.type === 'SOS_ALERT') {
        ws.isSosActive = true;
        const currentSettings = roomSettings.get(ws.roomId) || { sosMode: '10s' };
        const selectedMode = data.mode || currentSettings.sosMode;

        const roomSockets = activeRoomSockets.get(ws.roomId);
        if (roomSockets) {
          const payload = JSON.stringify({
            type: 'SOS_BROADCAST',
            userName: ws.userName,
            mode: selectedMode,
            timestamp: data.timestamp || new Date().toISOString()
          });
          
          for (const client of roomSockets) {
            if (client.readyState === WebSocket.OPEN) {
              if (client.userRole.toLowerCase() === 'guest' && client.isSosMuted) {
                continue;
              }
              client.send(payload);
            }
          }
        }
      }

      if (data.type === 'SOS_CLEAR') {
        ws.isSosActive = false;
        const roomSockets = activeRoomSockets.get(ws.roomId);
        if (roomSockets) {
          const payload = JSON.stringify({
            type: 'SOS_CLEAR_BROADCAST',
            targetUser: data.targetUser || ws.userName
          });
          for (const client of roomSockets) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(payload);
            }
          }
        }
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  ws.on('close', () => {

    // ============================================================
  // BUSINESS VIDEO â€” CLEANUP ON WEBSOCKET DISCONNECT
  // ============================================================
  if (
    ws.videoConferenceActive &&
    ws.roomId &&
    activeRoomSockets.has(ws.roomId)
  ) {
    const videoRoomSockets = activeRoomSockets.get(ws.roomId);

    for (const client of videoRoomSockets) {
      if (
        client !== ws &&
        client.readyState === WebSocket.OPEN &&
        client.videoConferenceActive === true
      ) {
        client.send(JSON.stringify({
          type: 'VIDEO_PEER_LEFT',
          peerId: ws.videoPeerId
        }));
      }
    }

    ws.videoConferenceActive = false;
  }

    if (ws.roomId && activeRoomSockets.has(ws.roomId)) {
      const roomSockets = activeRoomSockets.get(ws.roomId);
      roomSockets.delete(ws);

      if (ws.userRole && ws.userRole.toLowerCase() === 'admin') {
        const payload = JSON.stringify({ type: 'ADMIN_LEFT' });
        for (const client of roomSockets) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
            client.close();
          }
        }
        activeRoomSockets.delete(ws.roomId);
        roomSettings.delete(ws.roomId);
      }
      
      updateRoomGuestsList(ws.roomId);
      broadcastRoomMembers(ws.roomId);
    }
  });
});
app.get('/room.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});


server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});




