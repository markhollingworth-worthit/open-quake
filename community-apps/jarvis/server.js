const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const https = require('https');

let starting = false;

// Check if port 8000 is listening
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1', timeout: 300 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

// Download helper function supporting redirects
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`Failed to download: ${response.statusCode}`));
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          resolve();
        });
      });
    }).on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function handle(action, ctx) {
  if (action === 'start') {
    const isRunning = await checkPort(8000);
    if (isRunning) {
      return { ok: true, msg: 'Already running' };
    }
    
    if (starting) {
      return { ok: true, msg: 'Start in progress...' };
    }
    
    starting = true;
    const appDir = __dirname;
    const vbsPath = path.join(appDir, 'start_jarvis.vbs');
    const backendDir = path.join(appDir, 'Mark-XLVI');
    const exePath = path.join(backendDir, 'jarvis_backend.exe');
    
    // Download jarvis_backend.exe if both binary and main.py are missing
    const mainPyPath = path.join(backendDir, 'main.py');
    if (!fs.existsSync(exePath) && !fs.existsSync(mainPyPath)) {
      console.log('[JARVIS server.js] jarvis_backend.exe missing! Downloading from GitHub...');
      const downloadUrl = 'https://media.githubusercontent.com/media/1dark30-alt/open-quake-jarvis/add-jarvis-community-app/community-apps/jarvis/Mark-XLVI/jarvis_backend.exe';
      try {
        await downloadFile(downloadUrl, exePath);
        console.log('[JARVIS server.js] Download completed successfully!');
      } catch (err) {
        console.error('[JARVIS server.js] Download failed:', err);
        starting = false;
        return { ok: false, error: 'Failed to download JARVIS backend: ' + err.message };
      }
    }
    
    if (!fs.existsSync(exePath) && !fs.existsSync(mainPyPath)) {
      starting = false;
      return { ok: false, error: 'jarvis_backend.exe not found. Re-import the drop-in app.' };
    }
    
    if (!fs.existsSync(vbsPath)) {
      starting = false;
      return { ok: false, error: 'start_jarvis.vbs not found' };
    }
    
    // Write options to api_keys.json
    const configPath = path.join(backendDir, 'config', 'api_keys.json');
    try {
      const parentDir = path.dirname(configPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      
      let configData = {};
      if (fs.existsSync(configPath)) {
        try {
          configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (e) {}
      }
      
      // Update with values from open-quake options
      if (ctx.options.gemini_api_key !== undefined && !ctx.options.gemini_api_key.startsWith('oqenc:v1:')) {
        configData.gemini_api_key = ctx.options.gemini_api_key;
      }
      if (ctx.options.llm_provider !== undefined) {
        configData.llm_provider = ctx.options.llm_provider;
      }
      if (ctx.options.llm_url !== undefined) {
        configData.llm_url = ctx.options.llm_url;
      }
      if (ctx.options.llm_model !== undefined) {
        configData.llm_model = ctx.options.llm_model;
      }
      if (ctx.options.os_system !== undefined) {
        configData.os_system = ctx.options.os_system;
      }
      
      // Fallback defaults for missing keys
      if (configData.gemini_api_key === undefined) configData.gemini_api_key = '';
      if (configData.llm_provider === undefined) configData.llm_provider = 'gemini-live';
      if (configData.llm_url === undefined) configData.llm_url = '';
      if (configData.llm_model === undefined) configData.llm_model = '';
      if (configData.os_system === undefined) configData.os_system = 'windows';
      
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
      console.log('[JARVIS server.js] Synchronized engine settings to api_keys.json');
    } catch (e) {
      console.error('[JARVIS server.js] Failed to write api_keys.json:', e);
    }
    
    starting = true;
    setTimeout(() => {
      starting = false;
    }, 10000);

    // Spawn hidden backend directly if binary exists to bypass wscript.exe security policies
    if (fs.existsSync(exePath)) {
      execFile(exePath, [], { cwd: backendDir, windowsHide: true }, (err, stdout, stderr) => {
        starting = false;
        if (err) {
          console.error('[JARVIS server.js] Direct spawn failed:', err);
          try {
            fs.writeFileSync(path.join(backendDir, 'spawn_error.txt'), `Error: ${err.message}\nStdout: ${stdout}\nStderr: ${stderr}`, 'utf8');
          } catch(e) {}
        }
      });
    } else {
      // Fallback: spawn via VBScript if developer running from source
      execFile('wscript.exe', [vbsPath], { windowsHide: true }, (err, stdout, stderr) => {
        starting = false;
        if (err) {
          console.error('[JARVIS server.js] VBS spawn failed:', err);
        }
      });
    }
    
    return { ok: true, msg: 'Spawning JARVIS backend' };
  }
  
  if (action === 'status') {
    const isRunning = await checkPort(8000);
    return { ok: true, running: isRunning };
  }
  
  return { ok: false, error: 'unknown action' };
}

module.exports = { handle };
