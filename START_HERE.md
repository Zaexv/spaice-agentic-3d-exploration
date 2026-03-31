# 🚨 MULTIPLAYER TROUBLESHOOTING - START HERE

## Current Status

✅ **Multiplayer Server**: Running on port 3000
✅ **Vite Dev Server**: Running on port 5173
✅ **All files**: Created and verified

## ⚡ Quick Start (Do This Now)

### 1. Open Browser

Go to: **http://localhost:5173**

### 2. Open Developer Console

- **Windows/Linux**: Press `F12`
- **Mac**: Press `Cmd + Option + I`
- Click the **"Console"** tab

### 3. Look for These Messages

You should see:
```
🔍 Checking multiplayer server...
✓ Multiplayer server detected
✅ Multiplayer button initialized
```

### 4. Find the Button

Look in the **bottom-right corner** of the screen.
You should see: **🌐 Join Multiplayer**

If you DON'T see the button, check the console for errors.

## 🐛 What Could Be Wrong?

### Problem 1: "Multiplayer server not available"

**Fix:**
```bash
# In a new terminal (from the project root)
npm run multiplayer-server
```

### Problem 2: Button Not Showing

**Test in Console:**
```javascript
// Paste this in browser console
document.getElementById('multiplayer-btn')
```

**If it returns `null`:**
- Reload the page
- Check HTML file has `<button id="multiplayer-btn">`

**If it exists but hidden:**
```javascript
// Force show it
document.getElementById('multiplayer-btn').style.display = 'block';
```

### Problem 3: CORS Error

**Symptoms:** Console shows "CORS policy" error

**Fix:** Server should already have CORS enabled. If you see this:
1. Stop the multiplayer server (Ctrl+C)
2. Restart it: `npm run multiplayer-server`
3. Reload browser

### Problem 4: Connection Fails When Clicking Button

**Test in Console:**
```javascript
// Test server connection
fetch('http://localhost:3000/health')
  .then(r => r.json())
  .then(d => console.log('✅ Server OK:', d))
  .catch(e => console.error('❌ Error:', e));
```

## 📋 Full Diagnostic Test

Paste this entire block into your browser console:

```javascript
(async function fullDiagnostic() {
  console.clear();
  console.log('🔧 MULTIPLAYER FULL DIAGNOSTIC\n' + '='.repeat(50));
  
  // Test 1: HTML Elements
  console.log('\n📋 TEST 1: HTML Elements');
  const btn = document.getElementById('multiplayer-btn');
  const panel = document.getElementById('multiplayer-panel');
  console.log('  Button exists:', btn ? '✅' : '❌');
  console.log('  Button display:', btn?.style.display || 'not found');
  console.log('  Panel exists:', panel ? '✅' : '❌');
  
  // Test 2: Server Health
  console.log('\n🌐 TEST 2: Server Connection');
  try {
    const res = await fetch('http://localhost:3000/health', {timeout: 2000});
    const data = await res.json();
    console.log('  Health endpoint:', data.status === 'ok' ? '✅' : '❌', data);
  } catch (e) {
    console.log('  Health endpoint: ❌', e.message);
  }
  
  // Test 3: Server Status
  console.log('\n📊 TEST 3: Server Status');
  try {
    const res = await fetch('http://localhost:3000/status');
    const data = await res.json();
    console.log('  Status endpoint: ✅', data);
  } catch (e) {
    console.log('  Status endpoint: ❌', e.message);
  }
  
  // Test 4: App Instance
  console.log('\n🎮 TEST 4: App Instance');
  console.log('  window.app exists:', window.app ? '✅' : '❌');
  console.log('  toggleMultiplayer exists:', typeof window.app?.toggleMultiplayer === 'function' ? '✅' : '❌');
  console.log('  multiplayerManager exists:', window.app?.multiplayerManager ? '✅' : '❌');
  console.log('  multiplayerEnabled:', window.app?.multiplayerEnabled || false);
  
  // Test 5: Module Loading
  console.log('\n📦 TEST 5: Module Loading');
  try {
    const module = await import('/src/multiplayer/MultiplayerManager.js');
    console.log('  MultiplayerManager: ✅', typeof module.MultiplayerManager);
  } catch (e) {
    console.log('  MultiplayerManager: ❌', e.message);
  }
  
  try {
    const module = await import('/src/multiplayer/RemotePlayer.js');
    console.log('  RemotePlayer: ✅', typeof module.RemotePlayer);
  } catch (e) {
    console.log('  RemotePlayer: ❌', e.message);
  }
  
  // Test 6: Click Handler
  console.log('\n🖱️  TEST 6: Button Click Handler');
  if (btn) {
    const listeners = getEventListeners ? getEventListeners(btn) : null;
    console.log('  Click listeners:', listeners ? (listeners.click?.length || 0) + ' found' : 'Unknown (use Chrome)');
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ Diagnostic complete!');
  console.log('\nIf all tests pass, the button should be visible.');
  console.log('If button is there, click it and watch for errors.');
})();
```

## 🎯 Expected Results

After running the diagnostic, you should see:

```
📋 TEST 1: HTML Elements
  Button exists: ✅
  Button display: block
  Panel exists: ✅

🌐 TEST 2: Server Connection
  Health endpoint: ✅ {status: "ok"}

📊 TEST 3: Server Status  
  Status endpoint: ✅ {status: "online", players: 0, ...}

🎮 TEST 4: App Instance
  window.app exists: ✅
  toggleMultiplayer exists: ✅
  multiplayerManager exists: ❌ (until you connect)
  multiplayerEnabled: false

📦 TEST 5: Module Loading
  MultiplayerManager: ✅ function
  RemotePlayer: ✅ function
```

## 🚀 If Everything Passes

1. Look for the button in bottom-right: **🌐 Join Multiplayer**
2. Click it
3. You should see a notification: "Connected to multiplayer server"
4. Open another browser window/tab → Same URL
5. Click Join in second window
6. Fly around - you'll see each other!

## ❌ If Tests Fail

**Share this information:**

1. Copy the diagnostic output from console
2. Screenshot of any error messages
3. Terminal output from both servers
4. Tell me which test failed

---

## Emergency Manual Connection

If automatic detection fails, force it:

```javascript
// In browser console
import('/src/multiplayer/MultiplayerManager.js').then(async module => {
  const { MultiplayerManager } = module;
  window.app.multiplayerManager = new MultiplayerManager(
    window.app.sceneManager, 
    window.app.spacecraft
  );
  await window.app.multiplayerManager.connect('http://localhost:3000');
  window.app.multiplayerEnabled = true;
  console.log('✅ Manually connected!');
});
```

---

**Current URLs:**
- Application: http://localhost:5173
- Multiplayer Server: http://localhost:3000
- Test Page: http://localhost:5173/test-multiplayer.html
