require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

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
const app = express();
app.get('/api/test-firebase-admin', async (req, res) => {
    try {
        await firebaseAuth.listUsers(1);

        res.json({
            success: true,
            message: "Firebase Admin key is working!"
        });

    } catch (error) {
        console.error("Firebase Admin test failed:", error);

        res.status(500).json({
            success: false,
            message: "Firebase Admin key test failed.",
            error: error.message
        });
    }
});



const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// In-memory Data Stores (Cleaned up with zero pre-existing rooms)
const users = [];
const rooms = [];
const activeRoomSockets = new Map();
const roomSettings = new Map();

// Temporary OTP store for signup testing
const signupOtps = new Map();

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
    if (client.readyState === WebSocket.OPEN && client.userRole && client.userRole.toLowerCase() === 'admin') {
      return true;
    }
  }
  return false;
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

// ===============================
// SIGNUP OTP - DEVELOPMENT TEST
// ===============================
app.post('/api/signup/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required.'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // OTP expires after 5 minutes
    const expiresAt = Date.now() + 5 * 60 * 1000;

    // Save OTP temporarily
    signupOtps.set(normalizedEmail, {
      otp,
      expiresAt,
      attempts: 0
    });

    // Send OTP email
    const { data, error } = await resend.emails.send({
      from: 'TalkieTalkie <onboarding@resend.dev>',
      to: [normalizedEmail],
      subject: 'Your TalkieTalkie verification code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto;">
          <h2>TalkieTalkie Email Verification</h2>

          <p>Your verification code is:</p>

          <div style="
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 8px;
            padding: 20px;
            text-align: center;
            background: #f4f4f4;
            border-radius: 10px;
          ">
            ${otp}
          </div>

          <p>This code expires in <strong>5 minutes</strong>.</p>

          <p>If you did not request this code, you can ignore this email.</p>
        </div>
      `
    });

    if (error) {
      console.error('Resend email error:', error);

      // Remove OTP if email could not be sent
      signupOtps.delete(normalizedEmail);

      return res.status(500).json({
        success: false,
        message: 'Could not send verification email.'
      });
    }

    console.log(
  `OTP email sent to ${normalizedEmail} | PID: ${process.pid} | Stored: ${signupOtps.has(normalizedEmail)}`
);

    return res.status(200).json({
      success: true,
      message: 'Verification code sent to your email.'
    });

  } catch (error) {
    console.error('Send OTP error:', error);

    return res.status(500).json({
      success: false,
      message: 'Could not send verification email.'
    });
  }
});
// ===============================
// VERIFY SIGNUP OTP
// ===============================

app.post('/api/signup/verify-otp', (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required.'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const enteredOtp = String(otp).trim();

    const savedData = signupOtps.get(normalizedEmail);
    console.log(
  `OTP verification for ${normalizedEmail} | PID: ${process.pid} | Found: ${!!savedData}`
);

    if (!savedData) {
      return res.status(400).json({
        success: false,
        message: 'OTP not found. Please request a new OTP.'
      });
    }

    // Check if OTP has expired
    if (Date.now() > savedData.expiresAt) {
      signupOtps.delete(normalizedEmail);

      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new OTP.'
      });
    }

    // Check OTP
    if (enteredOtp !== savedData.otp) {
      savedData.attempts += 1;

      if (savedData.attempts >= 5) {
        signupOtps.delete(normalizedEmail);

        return res.status(429).json({
          success: false,
          message: 'Too many incorrect attempts. Please request a new OTP.'
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Incorrect OTP.'
      });
    }

    // OTP is correct
    signupOtps.delete(normalizedEmail);

    console.log(`OTP verified successfully for ${normalizedEmail}`);

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully.'
    });

  } catch (error) {
    console.error('OTP verification error:', error);

    return res.status(500).json({
      success: false,
      message: 'Could not verify OTP.'
    });
  }
});

// Authentication Routes
app.post('/api/auth/signup', (req, res) => {
  const { fullName, username, email, age, gender, country, password } = req.body;
  if (!fullName || !username || !email || !age || !gender || !country || !password) {
    return res.status(400).json({ success: false, message: 'Please fill in all required fields.' });
  }

  const newUser = { 
    id: String(Date.now()), 
    fullName, 
    username, 
    email, 
    age: Number(age), 
    gender, 
    country, 
    password,
    adminLogins: 0,
    guestLogins: 0
  };

  users.push(newUser);
  return res.status(201).json({ success: true, message: 'Account created successfully!', user: newUser });
});

app.post('/api/auth/login', (req, res) => {
  const { email, phone, username, password, identifier } = req.body;
  if (password) {
    const inputId = username || identifier || email;
    const user = users.find((u) => (u.email === inputId || u.username === inputId) && u.password === password);
    
    if (user) {
      user.adminLogins = (user.adminLogins || 0) + 1;

      return res.status(200).json({
        success: true,
        message: 'Login successful!',
        token: 'demo-jwt-token-' + user.id,
        user: { 
          id: user.id, 
          fullName: user.fullName, 
          username: user.username, 
          email: user.email,
          adminLogins: user.adminLogins,
          guestLogins: user.guestLogins
        }
      });
    }
    return res.status(401).json({ success: false, message: 'Invalid credentials. Please check your details.' });
  }
  return res.status(400).json({ success: false, message: 'Please provide valid login details.' });
});

// Logout Endpoint Added
app.post('/api/auth/logout', (req, res) => {
  const { username } = req.body;
  
  // Perform any optional server-side session/cleanup tasks here if necessary

  return res.status(200).json({ 
    success: true, 
    message: 'Logged out successfully.' 
  });
});

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
    const decodedToken = await firebaseAuth.verifyIdToken(idToken);
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
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname === '/ws/room') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.userName = null;
  ws.userRole = null;
  ws.joinedAt = null;
  ws.isSosMuted = false;

  ws.on('message', (message, isBinary) => {
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
        const { roomId, role, userName } = data;

        const currentMemberCount = getRoomMemberCount(roomId);
        if (currentMemberCount >= 6) {
          ws.send(JSON.stringify({ 
            type: 'ROOM_FULL', 
            code: 'LIMIT_ROOM_FULL',
            message: 'Room is full (1 Admin + 5 Guests max).' 
          }));
          ws.close();
          return;
        }

        if (role.toLowerCase() === 'guest' && !isAdminInRoom(roomId)) {
          ws.send(JSON.stringify({ type: 'ADMIN_NOT_PRESENT' }));
          ws.close();
          return;
        }

        ws.roomId = roomId;
        ws.userRole = role;
        ws.userName = userName || (role.toLowerCase() === 'admin' ? 'Administrator' : 'GuestUser');
        ws.joinedAt = new Date().toLocaleTimeString();

        if (!activeRoomSockets.has(roomId)) {
          activeRoomSockets.set(roomId, new Set());
        }
        activeRoomSockets.get(roomId).add(ws);

        if (!roomSettings.has(roomId)) {
          roomSettings.set(roomId, { sosMode: '10s' });
        }

        updateRoomGuestsList(roomId);
        broadcastRoomMembers(roomId);
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
        const roomSockets = activeRoomSockets.get(ws.roomId);
        if (roomSockets) {
          const payload = JSON.stringify({
            type: 'LOCATION_BROADCAST',
            userName: ws.userName,
            location: data.location
          });
          
          for (const client of roomSockets) {
            if (client.readyState === WebSocket.OPEN && client.userRole && client.userRole.toLowerCase() === 'admin') {
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
